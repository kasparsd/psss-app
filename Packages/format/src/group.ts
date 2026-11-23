// Section 4.4 (chains), section 5 (acceptance of content records), section 6 (membership, cuts, the fork rule) and section 9
// steps 3 and 4, put together into one reader as the fixed point of section 6.6.
// Everything here is a pure function of the set of records a reader holds: order of arrival does not matter.
import { cmp, eq, hex } from './bytes.ts';
import { CborError, type CborValue, type CMap } from './cbor.ts';
import { checkpointWritesOf, completeSets, fold, forgetUpTo, type State } from './fold.ts';
import { commitOf, FormatError, gidOf, verifyCard, type Card } from './keys.ts';
import { compareKeys, heldBack, KIND, MEMBERSHIP_KINDS, sortRecords, type OrderKey, type Rec } from './record.ts';
import { rules } from './limits.ts';

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

/** 4.4 (draft 3): a record is identified by its record_id; sealing is deterministic, so the same body is the same record.
 *  Two different record_ids at one (author, device, seq) are a fork. */
const bodyId = (r: Rec) => hex(r.id);

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
  /** the key of each epoch on the chain so far: the key the record that starts it is sealed under (6.3) */
  keys: Map<number, Uint8Array>;
}
/** `epoch`: the last epoch the cut reaches (6.2: the epoch of the member record; 6.4 draft 4: the epoch before the one a remove or replace record starts) */
export interface Cut { pid: string; record: string; epoch: number; cut: Map<string, number> }
export type ForkRule = 'dropped_by_other_candidate' | 'all_dropped_least' | 'least_author_device_seq';
/** `decidedBy`: which element of (author, device, seq) first told the winner from the runner-up (6.5 step 2). */
export type TieElement = 'author' | 'device' | 'seq';
export interface ForkNote { mprev: string; candidates: string[]; winner: string; rule: ForkRule; decidedBy: TieElement }
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
  /** 6.1: the lowest format version that may read the group, from the genesis in use */
  minReader: number;
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
  if (!eq(r.gid, gidOf(r.author, nonce, r.key, r.payload.get(4) as number))) return 'gid_mismatch';
  const card = asCard(r.payload.get(2));
  if (typeof card === 'string') return card;
  if (!eq(card.pid, r.author)) return 'card_is_not_the_creators';
  if (!eq(r.payload.get(3) as Uint8Array, commitOf(r.gid, 0, r.key))) return 'commit_mismatch';
  return null;
}

/** 6.3 to 6.4: the epoch a record starts. `e`, its commitment and K_(e-1) as carried in the payload. */
function epochProblem(r: Rec, s: MState, e: number, commit: Uint8Array, prevKey: Uint8Array): string | null {
  if (e !== s.epoch + 1) return 'wrong_epoch';
  // 6.4 (draft 4): the header of a record of kind 3, 4 or 5 MUST name the epoch it starts; the record is sealed under the new key K_e.
  if (rules.checkHeaderEpoch && r.epoch !== e) return 'wrong_header_epoch';
  if (!eq(commit, commitOf(r.gid, e, r.key))) return 'commit_mismatch';
  const prevCommit = s.commits.get(s.epoch);
  if (rules.checkPreviousKey && (!prevCommit || !eq(prevCommit, commitOf(r.gid, s.epoch, prevKey)))) return 'previous_key_mismatch';
  // 6.3 (draft 5): K_e is new random bytes; a record that carries the old key forward rotates nothing. (r.key is K_e: the key the record is sealed under.)
  if (rules.newKeyDiffers && eq(r.key, prevKey)) return 'new_key_repeats_an_earlier_key';
  // 6.3 (draft 5, revised): nor the key of any earlier epoch of the group on the accepted chain.
  if (rules.newKeyDiffersFromEarlier) for (const [ep, k] of s.keys) if (ep < s.epoch && eq(r.key, k)) return 'new_key_repeats_an_earlier_key';
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
      } else if (old === 0) return 'pid_for_a_non_member';
      const lowered = role < old;
      if (lowered !== r.payload.has(4)) return lowered ? 'lowering_needs_cut' : 'cut_without_lowering';
      const ce = s.cutEpochs.get(hex(pid));
      if (role > old && ce !== undefined && ce >= s.epoch) return 'raise_needs_new_epoch';
      return null;
    }
    case KIND.epoch:
      if (!manager) return 'author_not_manager';
      return epochProblem(r, s, r.payload.get(2) as number, r.payload.get(3) as Uint8Array, r.payload.get(4) as Uint8Array);
    case KIND.remove:
      if (!manager) return 'author_not_manager';
      if (roleOf(s.roles, r.payload.get(2) as Uint8Array) === 0) return 'not_a_member';
      return epochProblem(r, s, r.payload.get(4) as number, r.payload.get(5) as Uint8Array, r.payload.get(6) as Uint8Array);
    case KIND.replace: {
      const old = r.payload.get(2) as Uint8Array;
      if (roleOf(s.roles, old) === 0) return 'not_a_member';
      if (!(manager || eq(r.author, old))) return 'author_not_manager_or_the_person';
      const c = asCard(r.payload.get(3));
      if (typeof c === 'string') return c;
      if (roleOf(s.roles, c.pid) !== 0 || eq(c.pid, old)) return 'new_pid_is_member';
      return epochProblem(r, s, r.payload.get(5) as number, r.payload.get(6) as Uint8Array, r.payload.get(7) as Uint8Array);
    }
    default: return 'not_membership';
  }
}

/** 6.5 step 1: does candidate x remove, lower or replace the author of candidate y (as of their shared mprev)? */
function dropsAuthorOf(x: Rec, y: Rec, s: MState): boolean {
  if (x.kind === KIND.member) return eq(targetPid(x), y.author) && (x.payload.get(3) as number) < roleOf(s.roles, y.author);
  if (x.kind === KIND.remove || x.kind === KIND.replace) return eq(x.payload.get(2) as Uint8Array, y.author);
  return false;
}

/** 6.5 step 2 (draft 4): least by (author, device, seq). Two candidates cannot share all three: that would be a fork of one chain. */
const TIE_ELEMENTS: Record<string, (a: Rec, b: Rec) => number> = {
  author: (a, b) => cmp(a.author, b.author), device: (a, b) => cmp(a.device, b.device), seq: (a, b) => a.seq - b.seq,
};
const tieKey = (a: Rec, b: Rec): number => {
  for (const name of rules.tieBreak.split(',').filter(Boolean)) {
    const rev = name.startsWith('-');
    const c = TIE_ELEMENTS[rev ? name.slice(1) : name]!(a, b);
    if (c) return rev ? -c : c;
  }
  return 0;
};
function decidedBy(a: Rec, b: Rec): TieElement {
  return cmp(a.author, b.author) ? 'author' : cmp(a.device, b.device) ? 'device' : 'seq';
}

/** 6.5: of valid candidates naming one mprev, exactly one continues the chain. */
export function pickWinner(cands: Rec[], s: MState): { winner: Rec; rule: ForkRule; decidedBy: TieElement } {
  // 1. Drop every candidate whose author is removed, lowered or replaced by another candidate; if that drops them all, keep them all.
  const left = cands.filter((y) => !cands.some((x) => x !== y && dropsAuthorOf(x, y, s)));
  const pool = left.length ? left : cands;
  // 2. Of those left, the least by (author, device, seq).
  const sorted = [...pool].sort(tieKey);
  const rule: ForkRule = left.length === 0 ? 'all_dropped_least' : left.length < cands.length ? 'dropped_by_other_candidate' : 'least_author_device_seq';
  const winner = left.length === 0 && !rules.keepAllWhenAllDropped ? sorted[sorted.length - 1]! : sorted[0]!;
  return { winner, rule, decidedBy: sorted.length > 1 ? decidedBy(sorted[0]!, sorted[1]!) : 'author' };
}

export function resolveMembership(gid: Uint8Array, recs: Rec[]): Membership {
  const m: Membership = { chain: [], snaps: new Map(), ignored: new Map(), lost: new Set(), epoch: 0, roles: new Map(), commits: new Map(),
                          cuts: [], forks: [], duplicateGenesis: [], minReader: 1 };
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
  m.minReader = genesis.payload.get(4) as number;
  const st: MState = { epoch: 0, roles: new Map([[hex(genesis.author), 3]]), commits: new Map([[0, genesis.payload.get(3) as Uint8Array]]), cutEpochs: new Map(), keys: new Map([[0, genesis.key]]) };
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
      const pick = pickWinner(valid, st);
      winner = pick.winner;
      m.forks.push({ mprev: hex(head.id), candidates: valid.map((x) => hex(x.id)).sort(), winner: hex(winner.id), rule: pick.rule, decidedBy: pick.decidedBy });
      for (const l of valid) if (l !== winner) m.ignored.set(hex(l.id), 'lost_fork');
    }
    apply(winner, st, m);
    m.chain.push(winner);
    snap(winner);
    head = winner;
  }
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
  const startEpoch = (e: number, commit: Uint8Array) => { s.epoch = e; s.commits.set(e, commit); s.keys.set(e, r.key); };
  if (r.kind === KIND.member) {
    const pid = targetPid(r);
    const role = r.payload.get(3) as number;
    if (role < roleOf(s.roles, pid)) {
      m.cuts.push({ pid: hex(pid), record: hex(r.id), epoch: r.epoch, cut: cutOf(r.payload.get(4) as [Uint8Array, number][]) });
      s.cutEpochs.set(hex(pid), r.epoch);
    }
    s.roles.set(hex(pid), role);
  } else if (r.kind === KIND.epoch) {
    startEpoch(r.payload.get(2) as number, r.payload.get(3) as Uint8Array);
  } else if (r.kind === KIND.remove) {
    const pid = r.payload.get(2) as Uint8Array;
    // 6.4 (draft 4): the cut reaches only the epochs before the one the record starts
    const reach = rules.cutEndsBeforeNewEpoch ? r.epoch - 1 : r.epoch;
    m.cuts.push({ pid: hex(pid), record: hex(r.id), epoch: reach, cut: cutOf(r.payload.get(3) as [Uint8Array, number][]) });
    s.cutEpochs.set(hex(pid), reach);
    s.roles.set(hex(pid), 0);
    startEpoch(r.payload.get(4) as number, r.payload.get(5) as Uint8Array);
  } else if (r.kind === KIND.replace) {
    const old = r.payload.get(2) as Uint8Array;
    const nu = (r.payload.get(3) as CMap).get(1) as Uint8Array;
    const reach = rules.cutEndsBeforeNewEpoch ? r.epoch - 1 : r.epoch;
    m.cuts.push({ pid: hex(old), record: hex(r.id), epoch: reach, cut: cutOf(r.payload.get(4) as [Uint8Array, number][]) });
    s.cutEpochs.set(hex(old), reach);
    s.roles.set(hex(nu), roleOf(s.roles, old));
    s.roles.set(hex(old), 0);
    startEpoch(r.payload.get(5) as number, r.payload.get(6) as Uint8Array);
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

export interface PurgeRequest { item: string; by: string; record: string }
export interface GroupView {
  accepted: Rec[];
  chains: ChainResult;
  membership: Membership;
  /** accepted checkpoint records, parts of incomplete sets included (their writes fold at once; 5.3) */
  checkpoints: Rec[];
  /** the part 0 records of the complete sets: only these contribute `covered` and `purged` */
  completeSets: Rec[];
  covered: Covered;
  content: { rec: Rec; status: Status }[];
  held: Rec[];
  /** 5.4: purge requests by accepted writers or managers, and the items they name that no complete checkpoint has purged yet */
  purgeRequests: PurgeRequest[];
  hidden: string[];
  /** 6.1: genesis names a lowest reader version above 1: the group is not read at all */
  unsupported: boolean;
  state: State;
}

function mergeCovered(cps: Rec[]): Covered {
  const out: Covered = new Map();
  for (const cp of cps) {
    for (const c of cp.payload.get(4) as [Uint8Array, Uint8Array, number, Uint8Array][]) {
      const k = `${hex(c[0])}/${hex(c[1])}`;
      const cur = out.get(k);
      if (!cur || c[2] > cur.seq || (c[2] === cur.seq && cmp(c[3], cur.id) < 0)) out.set(k, { seq: c[2], id: c[3] });
    }
  }
  return out;
}

const sameCovered = (a: Covered, b: Covered) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k)?.seq === v.seq && eq(b.get(k)!.id, v.id));

export const SUPPORTED_VERSION = 1;

/** The whole reader (6.6): repeat (a) extend the membership chain, (b) accept checkpoints, (c) accept content, until nothing changes. */
export function evaluateGroup(gid: Uint8Array, all: Rec[], nowMs?: number): GroupView {
  const mine = all.filter((r) => eq(r.gid, gid));
  const held = nowMs === undefined ? [] : mine.filter((r) => heldBack(r.wall, nowMs));
  const recs = mine.filter((r) => !held.includes(r));
  let covered: Covered = new Map();
  let chains!: ChainResult, membership!: Membership, cps: Rec[] = [], sets: Rec[] = [];
  for (let i = 0; ; i++) {
    chains = acceptChains(recs, covered);
    membership = resolveMembership(gid, chains.accepted);
    if (membership.minReader > SUPPORTED_VERSION) {
      return { accepted: [], chains, membership, checkpoints: [], completeSets: [], covered: new Map(), content: [], held, purgeRequests: [], hidden: [], unsupported: true, state: new Map() };
    }
    cps = chains.accepted.filter((r) => r.kind === KIND.checkpoint && contentStatus(membership, r, true) === 'accepted');
    sets = completeSets(cps.map((rec) => ({ rec, ...checkpointWritesOf(rec.payload, rec) }))).map((x) => x.rec);
    const next = mergeCovered(sets);
    if (sameCovered(next, covered)) break;
    covered = next;
    if (i > recs.length + 2) throw new Error('reader did not converge');
  }
  const content = chains.accepted.filter((r) => r.kind !== KIND.checkpoint && !MEMBERSHIP_KINDS.includes(r.kind))
    .map((rec) => ({ rec, status: contentStatus(membership, rec) }));
  const changes = content.filter((c) => c.rec.kind === KIND.item && c.status === 'accepted').map((c) => c.rec);
  const state = fold(sortRecords(changes), cps.map((c) => checkpointWritesOf(c.payload, c)));
  // 5.4 (draft 4): a purge request covers the writes of its items up to its own place in the order; every reader hides those writes at
  // once, and a write that is later in the order stays. A complete checkpoint whose `purged` names the item answers the request.
  const purgeRequests: PurgeRequest[] = [];
  const upTo = new Map<string, OrderKey>();
  const asked = new Map<string, OrderKey>();
  for (const c of content) if (c.rec.kind === KIND.purge && c.status === 'accepted') {
    for (const id of c.rec.payload.get(1) as Uint8Array[]) {
      purgeRequests.push({ item: hex(id), by: hex(c.rec.author), record: hex(c.rec.id) });
      const cur = asked.get(hex(id));
      if (!cur || compareKeys(c.rec.key5, cur) > 0) asked.set(hex(id), c.rec.key5);
    }
  }
  // 5.4 (draft 5): answered once a complete, accepted checkpoint names the item in `purged` at or after the request's place.
  const purgedAt = new Map<string, OrderKey>();
  for (const cp of sets) for (const pu of cp.payload.get(6) as [Uint8Array, CborValue[]][]) {
    const c = pu[1] as unknown as CborValue[];
    const k: OrderKey = [c[0] as number, c[1] as number, c[2] as Uint8Array, c[3] as Uint8Array, c[4] as number];
    const cur = purgedAt.get(hex(pu[0]));
    if (!cur || compareKeys(k, cur) > 0) purgedAt.set(hex(pu[0]), k);
  }
  const answeredBy = (id: string, from: OrderKey) => { const k = purgedAt.get(id); return !!k && (!rules.answerNeedsPlace || compareKeys(k, from) >= 0); };
  if (rules.purgeUpToOwnPlace) for (const [id, k] of asked) upTo.set(id, k);
  forgetUpTo(state, upTo);
  if (!rules.purgeUpToOwnPlace) for (const id of asked.keys()) state.delete(id);
  const unansweredItems: string[] = [];
  for (const c of content) if (c.rec.kind === KIND.purge && c.status === 'accepted') {
    for (const id of c.rec.payload.get(1) as Uint8Array[]) if (!answeredBy(hex(id), c.rec.key5)) unansweredItems.push(hex(id));
  }
  const hidden = [...new Set(unansweredItems)].sort();
  return { accepted: chains.accepted, chains, membership, checkpoints: cps, completeSets: sets, covered, content, held, purgeRequests, hidden, unsupported: false, state };
}

export type { CborValue };
