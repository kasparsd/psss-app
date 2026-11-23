// Section 4.4 (chains), section 5 (acceptance of content records), section 6 (membership, cuts, the fork rule) and section 9
// steps 3 and 4, put together into one reader as the fixed point of section 6.6.
// Everything here is a pure function of the set of records a reader holds: order of arrival does not matter.
import { cmp, eq, hex } from './bytes.ts';
import { CborError, encode, type CborValue, type CMap } from './cbor.ts';
import { checkpointWritesOf, fold, type State } from './fold.ts';
import { commitOf, FormatError, gidOf, verifyCard, type Card } from './keys.ts';
import { heldBack, KIND, MEMBERSHIP_KINDS, sortRecords, type Rec } from './record.ts';

const chainKey = (r: { author: Uint8Array; device: Uint8Array }) => `${hex(r.author)}/${hex(r.device)}`;

// ---------------------------------------------------------------- 4.4 chains

export type Covered = Map<string, { seq: number; id: Uint8Array }>;
export interface ChainResult {
  accepted: Rec[];
  /** chain -> the seq at which two records with different bodies exist (4.4) */
  forks: Map<string, { seq: number; ids: Uint8Array[] }>;
  /** records at or after the fork seq of a forked chain: kept for display, never accepted */
  forkBlocked: Rec[];
  waiting: { rec: Rec; reason: 'gap' | 'prev_mismatch' }[];
  /** records that contradict a checkpoint's covered entry for their chain */
  mismatches: Rec[];
}

/** 4.4. "Two sealed records with the same body bytes are the same record": the body includes its signature, which covers the
 *  header, so this holds only for records with identical headers (finding). */
const bodyId = (r: Rec) => hex(encode(r.body));

export function acceptChains(recs: Rec[], covered: Covered = new Map()): ChainResult {
  const chains = new Map<string, Rec[]>();
  const seen = new Set<string>();
  for (const r of recs) {
    const id = hex(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const k = chainKey(r);
    if (!chains.has(k)) chains.set(k, []);
    chains.get(k)!.push(r);
  }
  const res: ChainResult = { accepted: [], forks: new Map(), forkBlocked: [], waiting: [], mismatches: [] };
  for (const [k, list] of chains) {
    const cov = covered.get(k);
    const c = cov ? cov.seq : 0;
    list.sort((a, b) => a.seq - b.seq || cmp(a.id, b.id));
    const bySeq = new Map<number, Rec[]>();
    for (const r of list) { if (!bySeq.has(r.seq)) bySeq.set(r.seq, []); bySeq.get(r.seq)!.push(r); }
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    let forkSeq: number | undefined;
    for (const s of seqs) {
      if (new Set(bySeq.get(s)!.map(bodyId)).size > 1) { forkSeq = s; res.forks.set(k, { seq: s, ids: bySeq.get(s)!.map((r) => r.id) }); break; }
    }
    let p = c; // highest seq that is present (held and accepted) or covered
    let prevIds: Uint8Array[] = cov ? [cov.id] : [];
    let stopped = false;
    for (const s of seqs) {
      const accHere: Rec[] = [];
      for (const r of bySeq.get(s)!) {
        if (forkSeq !== undefined && s >= forkSeq) { res.forkBlocked.push(r); continue; }
        if (s <= c) {
          if (s === c && cov && !eq(r.id, cov.id)) res.mismatches.push(r); else res.accepted.push(r);
          continue;
        }
        if (stopped) { res.waiting.push({ rec: r, reason: 'gap' }); continue; }
        if (s !== p + 1) { stopped = true; res.waiting.push({ rec: r, reason: 'gap' }); continue; }
        const ok = p === 0 ? r.prev === null : r.prev !== null && prevIds.some((x) => eq(x, r.prev!));
        if (!ok) { stopped = true; res.waiting.push({ rec: r, reason: 'prev_mismatch' }); continue; }
        res.accepted.push(r);
        accHere.push(r);
      }
      if (accHere.length) { p = s; prevIds = accHere.map((r) => r.id); }
    }
  }
  return res;
}

// ---------------------------------------------------------------- 6 membership

export const ROLE = { removed: 0, reader: 1, writer: 2, manager: 3 } as const;

interface Snap { epoch: number; roles: Map<string, number> }
interface MState extends Snap {
  commits: Map<number, Uint8Array>;
  /** the epoch of the latest lowering record, per person (6.2: raising needs a new epoch first) */
  cutEpochs: Map<string, number>;
}
export interface Cut { pid: string; record: string; epoch: number; cut: Map<string, number> }
export type ForkRule = 'epoch_after_removal' | 'dropped_by_other_candidate' | 'all_dropped_least' | 'least_author_device_seq';
export interface ForkNote { mprev: string; candidates: string[]; winner: string; rule: ForkRule }
export interface Membership {
  chain: Rec[];
  /** the state as of each record on the chain (after applying it) */
  snaps: Map<string, Snap>;
  ignored: Map<string, string>;
  /** membership records that are on a losing branch: their `mprev` is held and is on the chain or on a losing branch */
  lost: Set<string>;
  epoch: number;
  roles: Map<string, number>;
  commits: Map<number, Uint8Array>;
  cuts: Cut[];
  /** removals and replacements after the last epoch record: the group is waiting for a new key (6.3) */
  pendingEpoch: string[];
  waitingForKey: boolean;
  forks: ForkNote[];
  duplicateGenesis: string[];
}

const roleOf = (roles: Map<string, number>, pid: Uint8Array) => roles.get(hex(pid)) ?? 0;
const targetPid = (r: Rec): Uint8Array => {
  const t = r.payload.get(2) as Uint8Array | CMap;
  return t instanceof Uint8Array ? t : (t.get(1) as Uint8Array);
};
const asCard = (v: unknown): Card | string => {
  try { return verifyCard(v); } catch (e) { return e instanceof FormatError ? e.code : e instanceof CborError ? e.reason : 'bad_card'; }
};

/** 6.1 */
function genesisProblem(r: Rec): string | null {
  if (r.epoch !== 0) return 'genesis_epoch';
  if (r.seq !== 1) return 'genesis_seq';
  const nonce = r.payload.get(1) as Uint8Array;
  if (!eq(r.gid, gidOf(r.author, nonce, r.key))) return 'gid_mismatch';
  const card = asCard(r.payload.get(2));
  if (typeof card === 'string') return card;
  if (!eq(card.pid, r.author)) return 'card_is_not_the_creators';
  if (!eq(r.payload.get(3) as Uint8Array, commitOf(r.gid, 0, r.key))) return 'commit_mismatch';
  return null;
}

/** 6.2 to 6.4, section 9 step 4: is `r` valid as of its `mprev`? Returns a reason or null. */
function memberProblem(r: Rec, s: MState): string | null {
  const manager = roleOf(s.roles, r.author) === ROLE.manager;
  switch (r.kind) {
    case KIND.member: {
      if (r.epoch !== s.epoch) return 'wrong_epoch'; // 6: sealed under the epoch as of its mprev
      if (!manager) return 'author_not_manager';
      const t = r.payload.get(2);
      const pid = targetPid(r);
      const role = r.payload.get(3) as number;
      const old = roleOf(s.roles, pid);
      if (t instanceof Map) {
        const c = asCard(t);
        if (typeof c === 'string') return c;
        if (old !== 0) return 'card_for_a_member'; // 6.2: a card only when the person is not a member
        if (role === 0) return 'target_not_member';
      } else if (old === 0) return 'pid_for_a_non_member';
      const lowered = role < old;
      if (lowered !== r.payload.has(4)) return lowered ? 'lowering_needs_cut' : 'cut_without_lowering';
      const ce = s.cutEpochs.get(hex(pid));
      if (role > old && ce !== undefined && ce >= s.epoch) return 'raise_needs_new_epoch';
      return null;
    }
    case KIND.epoch: {
      const e = r.payload.get(2) as number;
      if (!manager) return 'author_not_manager';
      if (e !== s.epoch + 1 || r.epoch !== e) return 'wrong_epoch';
      if (!eq(r.payload.get(3) as Uint8Array, commitOf(r.gid, e, r.key))) return 'commit_mismatch';
      const prevCommit = s.commits.get(s.epoch);
      if (!prevCommit || !eq(prevCommit, commitOf(r.gid, s.epoch, r.payload.get(4) as Uint8Array))) return 'previous_key_mismatch';
      return null;
    }
    case KIND.replace: {
      if (r.epoch !== s.epoch) return 'wrong_epoch';
      const old = r.payload.get(2) as Uint8Array;
      if (roleOf(s.roles, old) === 0) return 'not_a_member';
      if (!(manager || eq(r.author, old))) return 'author_not_manager_or_the_person';
      const c = asCard(r.payload.get(3));
      if (typeof c === 'string') return c;
      if (roleOf(s.roles, c.pid) !== 0 || eq(c.pid, old)) return 'new_pid_is_member';
      return null;
    }
    default: return 'not_membership';
  }
}

/** 6.5 step 2: does candidate x remove, lower or replace the author of candidate y (as of their shared mprev)? */
function dropsAuthorOf(x: Rec, y: Rec, s: MState): boolean {
  if (x.kind === KIND.member) return eq(targetPid(x), y.author) && (x.payload.get(3) as number) < roleOf(s.roles, y.author);
  if (x.kind === KIND.replace) return eq(x.payload.get(2) as Uint8Array, y.author);
  return false;
}

const tieKey = (a: Rec, b: Rec) => cmp(a.author, b.author) || cmp(a.device, b.device) || a.seq - b.seq || cmp(a.id, b.id);

/** 6.5: of valid candidates naming one mprev, exactly one continues the chain. */
function pickWinner(cands: Rec[], head: Rec, s: MState): { winner: Rec; rule: ForkRule } {
  // 1. After a removal or replacement, an epoch record by the author of mprev wins.
  const removal = (head.kind === KIND.member && (head.payload.get(3) as number) === 0) || head.kind === KIND.replace;
  if (removal) {
    const e = cands.filter((c) => c.kind === KIND.epoch && eq(c.author, head.author));
    if (e.length) return { winner: [...e].sort(tieKey)[0]!, rule: 'epoch_after_removal' };
  }
  // 2. Drop candidates whose author is removed, lowered or replaced by another candidate; if that drops them all, keep them all.
  const left = cands.filter((y) => !cands.some((x) => x !== y && dropsAuthorOf(x, y, s)));
  const pool = left.length ? left : cands;
  // 3. The least by (author, device, seq, record_id).
  const w = [...pool].sort(tieKey)[0]!;
  return { winner: w, rule: left.length === 0 ? 'all_dropped_least' : left.length < cands.length ? 'dropped_by_other_candidate' : 'least_author_device_seq' };
}

export function resolveMembership(gid: Uint8Array, recs: Rec[]): Membership {
  const m: Membership = { chain: [], snaps: new Map(), ignored: new Map(), lost: new Set(), epoch: 0, roles: new Map(), commits: new Map(),
                          cuts: [], pendingEpoch: [], waitingForKey: false, forks: [], duplicateGenesis: [] };
  const mine = recs.filter((r) => eq(r.gid, gid) && MEMBERSHIP_KINDS.includes(r.kind));
  const good: Rec[] = [];
  for (const g of mine.filter((r) => r.kind === KIND.genesis)) {
    const p = genesisProblem(g);
    if (p) m.ignored.set(hex(g.id), p); else good.push(g);
  }
  if (good.length === 0) return m;
  // 6.1: with more than one valid genesis, the one with the smallest record_id.
  good.sort((a, b) => cmp(a.id, b.id));
  const genesis = good[0]!;
  for (const g of good.slice(1)) { m.ignored.set(hex(g.id), 'duplicate_genesis'); m.duplicateGenesis.push(hex(g.id)); }
  const st: MState = { epoch: 0, roles: new Map([[hex(genesis.author), 3]]), commits: new Map([[0, genesis.payload.get(3) as Uint8Array]]), cutEpochs: new Map() };
  const snap = (r: Rec) => m.snaps.set(hex(r.id), { epoch: st.epoch, roles: new Map(st.roles) });
  m.chain.push(genesis);
  snap(genesis);
  const others = mine.filter((r) => r.kind !== KIND.genesis);
  let head = genesis;
  for (;;) {
    const cands = others.filter((r) => eq(r.payload.get(1) as Uint8Array, head.id));
    const valid: Rec[] = [];
    for (const r of cands) {
      const p = memberProblem(r, st);
      if (p) m.ignored.set(hex(r.id), p); else valid.push(r);
    }
    if (valid.length === 0) break;
    let winner = valid[0]!;
    if (valid.length > 1) {
      const pick = pickWinner(valid, head, st);
      winner = pick.winner;
      m.forks.push({ mprev: hex(head.id), candidates: valid.map((x) => hex(x.id)).sort(), winner: hex(winner.id), rule: pick.rule });
      for (const l of valid) if (l !== winner) m.ignored.set(hex(l.id), 'lost_fork');
    }
    apply(winner, st, m);
    m.chain.push(winner);
    snap(winner);
    head = winner;
  }
  // 6.3: a removal or replacement leaves the group waiting for a new key until an epoch record follows it on the chain.
  let lastEpoch = -1, lastRemoval = -1;
  m.chain.forEach((r, i) => {
    if (r.kind === KIND.epoch) lastEpoch = i;
    if ((r.kind === KIND.member && (r.payload.get(3) as number) === 0) || r.kind === KIND.replace) lastRemoval = i;
  });
  m.waitingForKey = lastRemoval > lastEpoch;
  m.pendingEpoch = m.chain.filter((r, i) => i > lastEpoch && ((r.kind === KIND.member && (r.payload.get(3) as number) === 0) || r.kind === KIND.replace)).map((r) => hex(r.id));
  m.epoch = st.epoch;
  m.roles = st.roles;
  m.commits = st.commits;
  // Which records that are not on the chain lost, and which cannot be judged yet (their mprev is not held).
  const onChain = new Set(m.chain.map((r) => hex(r.id)));
  const byId = new Map(others.map((r) => [hex(r.id), r] as const));
  const lostMemo = new Map<string, boolean>();
  const isLost = (r: Rec, depth = 0): boolean => {
    const id = hex(r.id);
    if (onChain.has(id)) return false;
    const memo = lostMemo.get(id);
    if (memo !== undefined) return memo;
    const parent = hex(r.payload.get(1) as Uint8Array);
    const v = depth > others.length ? false : onChain.has(parent) || (byId.has(parent) && isLost(byId.get(parent)!, depth + 1));
    lostMemo.set(id, v);
    return v;
  };
  for (const r of others) {
    const id = hex(r.id);
    if (onChain.has(id)) continue;
    if (isLost(r)) { m.lost.add(id); if (!m.ignored.has(id)) m.ignored.set(id, 'off_chain'); }
    else if (!m.ignored.has(id)) m.ignored.set(id, 'unreached');
  }
  return m;
}

function apply(r: Rec, s: MState, m: Membership): void {
  const cutOf = (list: [Uint8Array, number][]) => new Map(list.map((c) => [hex(c[0]), c[1]] as const));
  if (r.kind === KIND.member) {
    const pid = targetPid(r);
    const role = r.payload.get(3) as number;
    if (role < roleOf(s.roles, pid)) {
      m.cuts.push({ pid: hex(pid), record: hex(r.id), epoch: r.epoch, cut: cutOf(r.payload.get(4) as [Uint8Array, number][]) });
      s.cutEpochs.set(hex(pid), r.epoch);
    }
    s.roles.set(hex(pid), role);
  } else if (r.kind === KIND.epoch) {
    s.epoch = r.payload.get(2) as number;
    s.commits.set(s.epoch, r.payload.get(3) as Uint8Array);
  } else if (r.kind === KIND.replace) {
    const old = r.payload.get(2) as Uint8Array;
    const nu = (r.payload.get(3) as CMap).get(1) as Uint8Array;
    m.cuts.push({ pid: hex(old), record: hex(r.id), epoch: r.epoch, cut: cutOf(r.payload.get(4) as [Uint8Array, number][]) });
    s.cutEpochs.set(hex(old), r.epoch);
    s.roles.set(hex(nu), roleOf(s.roles, old));
    s.roles.set(hex(old), 0);
  }
}

// ---------------------------------------------------------------- section 5 and 9 step 4 for content records

export type Status = 'accepted' | `waits:${string}` | `ignored:${string}`;

/** Section 5: a content record is accepted when `mhead` is on the accepted membership chain, its author is a writer (a manager
 *  for a checkpoint) as of `mhead`, the epoch in its header is the epoch as of `mhead`, it was sealed under the key the winning
 *  epoch record commits to, and it is not beyond a cut (6.2). A `mhead` that is not held yet makes it wait. */
export function contentStatus(m: Membership, r: Rec, needManager = false): Status {
  const mh = r.mhead ? hex(r.mhead) : '';
  const snap = m.snaps.get(mh);
  if (!snap) return m.lost.has(mh) ? 'ignored:mhead_not_on_chain' : 'waits:mhead_unknown';
  const role = roleOf(snap.roles, r.author);
  if (role < (needManager ? ROLE.manager : ROLE.writer)) return needManager ? 'ignored:not_manager' : 'ignored:not_writer';
  if (r.epoch !== snap.epoch) return 'ignored:wrong_epoch';
  const commit = m.commits.get(r.epoch);
  if (!commit || !eq(commit, commitOf(r.gid, r.epoch, r.key))) return 'ignored:wrong_epoch_key';
  const who = hex(r.author);
  for (const c of m.cuts) {
    if (c.pid === who && r.epoch <= c.epoch && r.seq > (c.cut.get(hex(r.device)) ?? 0)) return 'ignored:beyond_cut';
  }
  return 'accepted';
}

export interface GroupView {
  accepted: Rec[];
  chains: ChainResult;
  membership: Membership;
  checkpoints: Rec[];
  covered: Covered;
  content: { rec: Rec; status: Status }[];
  held: Rec[];
  /** 6.3: false while the group waits for a new key; a device MUST NOT seal content records then */
  maySealContent: boolean;
  state: State;
}

function mergeCovered(cps: Rec[]): Covered {
  const out: Covered = new Map();
  for (const cp of cps) {
    for (const c of cp.payload.get(1) as [Uint8Array, Uint8Array, number, Uint8Array][]) {
      const k = `${hex(c[0])}/${hex(c[1])}`;
      const cur = out.get(k);
      if (!cur || c[2] > cur.seq || (c[2] === cur.seq && cmp(c[3], cur.id) < 0)) out.set(k, { seq: c[2], id: c[3] });
    }
  }
  return out;
}

const sameCovered = (a: Covered, b: Covered) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k)?.seq === v.seq && eq(b.get(k)!.id, v.id));

/** The whole reader (6.6): repeat (a) extend the membership chain, (b) accept checkpoints, (c) accept content, until nothing changes. */
export function evaluateGroup(gid: Uint8Array, all: Rec[], nowMs?: number): GroupView {
  const mine = all.filter((r) => eq(r.gid, gid));
  const held = nowMs === undefined ? [] : mine.filter((r) => heldBack(r.wall, nowMs));
  const recs = mine.filter((r) => !held.includes(r));
  let covered: Covered = new Map();
  let chains!: ChainResult, membership!: Membership, cps: Rec[] = [];
  for (let i = 0; ; i++) {
    chains = acceptChains(recs, covered);
    membership = resolveMembership(gid, chains.accepted);
    cps = chains.accepted.filter((r) => r.kind === KIND.checkpoint && contentStatus(membership, r, true) === 'accepted');
    const next = mergeCovered(cps);
    if (sameCovered(next, covered)) break;
    covered = next;
    if (i > recs.length + 2) throw new Error('reader did not converge');
  }
  const content = chains.accepted.filter((r) => r.kind !== KIND.checkpoint && !MEMBERSHIP_KINDS.includes(r.kind))
    .map((rec) => ({ rec, status: contentStatus(membership, rec) }));
  const changes = content.filter((c) => c.rec.kind === KIND.item && c.status === 'accepted').map((c) => c.rec);
  const state = fold(sortRecords(changes), cps.map((c) => checkpointWritesOf(c.payload)));
  return { accepted: chains.accepted, chains, membership, checkpoints: cps, covered, content, held, maySealContent: !membership.waitingForKey, state };
}

export type { CborValue };
