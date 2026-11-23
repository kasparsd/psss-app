// Section 4.4 (chains), section 6 (membership) and section 9 steps 4 and 5, put together into one reader.
// Everything here is a pure function of the set of records a reader holds: order of arrival does not matter.
import { cmp, eq, hex } from './bytes.ts';
import { CborError, type CborValue, type CMap } from './cbor.ts';
import { commitOf, gidOf, verifyCard, type Card } from './keys.ts';
import { fold, type State } from './fold.ts';
import { heldBack, KIND, MEMBERSHIP_KINDS, sortRecords, type Rec } from './record.ts';

const chainKey = (r: { author: Uint8Array; device: Uint8Array }) => `${hex(r.author)}/${hex(r.device)}`;

// ---------------------------------------------------------------- 4.4 chains

export type Covered = Map<string, { seq: number; id: Uint8Array }>;
export interface ChainResult {
  accepted: Rec[];
  /** chain -> the seq at which two different records exist (4.4) */
  forks: Map<string, { seq: number; ids: Uint8Array[] }>;
  waiting: { rec: Rec; reason: 'gap' | 'prev_mismatch' }[];
  /** records at or after the fork seq of a forked chain: kept for display, never accepted (4.4) */
  forkBlocked: Rec[];
  /** records that contradict a checkpoint's covered entry for their chain */
  mismatches: Rec[];
}

/** 4.4: accept a record only when every earlier record of its chain is present or covered; a fork stops the chain. */
export function acceptChains(recs: Rec[], covered: Covered = new Map()): ChainResult {
  const byId = new Map<string, Rec>();
  for (const r of recs) byId.set(hex(r.id), r);
  const chains = new Map<string, Rec[]>();
  for (const r of byId.values()) {
    const k = chainKey(r);
    if (!chains.has(k)) chains.set(k, []);
    chains.get(k)!.push(r);
  }
  const res: ChainResult = { accepted: [], forks: new Map(), waiting: [], forkBlocked: [], mismatches: [] };
  for (const [k, list] of chains) {
    const cov = covered.get(k);
    const c = cov ? cov.seq : 0;
    list.sort((a, b) => a.seq - b.seq || cmp(a.id, b.id));
    const seqs = [...new Set(list.map((r) => r.seq))];
    let forkSeq: number | undefined;
    for (const s of seqs) {
      const same = list.filter((r) => r.seq === s);
      if (s > c && same.length > 1) { forkSeq = s; res.forks.set(k, { seq: s, ids: same.map((r) => r.id) }); break; }
    }
    let last = c; // highest seq known to be fine
    let lastId: Uint8Array | null = cov ? cov.id : null;
    let stopped = false;
    for (const s of seqs) {
      for (const r of list.filter((x) => x.seq === s)) {
        if (s <= c) {
          if (s === c && cov && !eq(r.id, cov.id)) res.mismatches.push(r);
          else res.accepted.push(r);
          continue;
        }
        if (forkSeq !== undefined && s >= forkSeq) { stopped = true; res.forkBlocked.push(r); continue; }
        if (stopped) { res.waiting.push({ rec: r, reason: 'gap' }); continue; }
        if (s !== last + 1) { stopped = true; res.waiting.push({ rec: r, reason: 'gap' }); continue; }
        const expectPrev = last === 0 ? null : lastId;
        if ((expectPrev === null) !== (r.prev === null) || (expectPrev && r.prev && !eq(expectPrev, r.prev))) {
          stopped = true; res.waiting.push({ rec: r, reason: 'prev_mismatch' }); continue;
        }
        res.accepted.push(r);
        last = s; lastId = r.id;
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------- 6 membership

export const ROLE = { removed: 0, reader: 1, writer: 2, manager: 3 } as const;

interface MState {
  epoch: number;
  roles: Map<string, number>;
  commits: Map<number, Uint8Array>;
}
export interface Cut { pid: string; record: string; cut: Map<string, number> }
export interface ForkNote { mprev: string; winner: string; losers: string[]; rule: 'removes_or_lowers' | 'smaller_record_id' | 'cycle_smaller_record_id' }
export interface Membership {
  chain: Rec[];
  ignored: Map<string, string>;
  epoch: number;
  roles: Map<string, number>;
  writersByEpoch: Map<number, Set<string>>;
  managersByEpoch: Map<number, Set<string>>;
  cuts: Cut[];
  /** removals and replacements not yet followed by an epoch record from the same author (6.3, 6.4) */
  pendingEpoch: string[];
  genesisFork: boolean;
  forks: ForkNote[];
}

const roleOf = (s: MState, pid: Uint8Array) => s.roles.get(hex(pid)) ?? 0;
const targetPid = (r: Rec): Uint8Array => {
  const t = r.payload.get(2) as Uint8Array | CMap;
  return t instanceof Uint8Array ? t : (t.get(1) as Uint8Array);
};
const asCard = (v: unknown): Card | string => {
  try { return verifyCard(v); } catch (e) { return (e as Error).message; }
};

/** 6.1 */
function genesisProblem(r: Rec): string | null {
  if (r.kind !== KIND.genesis) return 'not_genesis';
  if (r.epoch !== 0) return 'genesis_epoch';
  if (r.seq !== 1) return 'genesis_seq';
  const nonce = r.payload.get(1) as Uint8Array;
  if (!eq(r.gid, gidOf(r.author, nonce))) return 'gid_mismatch';
  const card = asCard(r.payload.get(2));
  if (typeof card === 'string') return card;
  if (!eq(card.pid, r.author)) return 'card_is_not_the_creators';
  if (!eq(r.payload.get(3) as Uint8Array, commitOf(r.gid, 0, r.key))) return 'commit_mismatch';
  return null;
}

/** 6.2 to 6.4, section 9 step 4: is `r` a valid next record given the state at its mprev? Returns a reason or null. */
function memberProblem(r: Rec, s: MState): string | null {
  const authorRole = roleOf(s, r.author);
  const bytesEq = (k: number, v: Uint8Array) => eq(r.payload.get(k) as Uint8Array, v);
  void bytesEq;
  switch (r.kind) {
    case KIND.member: {
      if (r.epoch !== s.epoch) return 'wrong_epoch';
      if (authorRole !== ROLE.manager) return 'author_not_manager';
      const t = r.payload.get(2);
      let pid: Uint8Array;
      if (t instanceof Uint8Array) pid = t;
      else { const c = asCard(t); if (typeof c === 'string') return c; pid = c.pid; }
      const role = r.payload.get(3) as number;
      const old = roleOf(s, pid);
      const hasCut = r.payload.has(4);
      if (old === 0) {
        if (!(t instanceof Map)) return 'add_needs_card';
        if (role === 0) return 'target_not_member';
        if (hasCut) return 'cut_without_lowering';
        return null;
      }
      if (role < old) return hasCut ? null : 'lowering_needs_cut';
      return hasCut ? 'cut_without_lowering' : null;
    }
    case KIND.epoch: {
      const e = r.payload.get(2) as number;
      if (authorRole !== ROLE.manager) return 'author_not_manager';
      if (e !== s.epoch + 1 || r.epoch !== e) return 'wrong_epoch';
      if (!eq(r.payload.get(3) as Uint8Array, commitOf(r.gid, e, r.key))) return 'commit_mismatch';
      const prevCommit = s.commits.get(s.epoch);
      if (!prevCommit || !eq(prevCommit, commitOf(r.gid, s.epoch, r.payload.get(4) as Uint8Array))) return 'previous_key_mismatch';
      return null;
    }
    case KIND.replace: {
      if (r.epoch !== s.epoch) return 'wrong_epoch';
      const old = r.payload.get(2) as Uint8Array;
      if (roleOf(s, old) === 0) return 'not_a_member';
      if (!(authorRole === ROLE.manager || eq(r.author, old))) return 'author_not_manager_or_the_person';
      const c = asCard(r.payload.get(3));
      if (typeof c === 'string') return c;
      if (roleOf(s, c.pid) !== 0 || eq(c.pid, old)) return 'new_pid_is_member';
      return null;
    }
    default: return 'not_membership';
  }
}

/** 6.5: x dominates y when x removes or lowers y's author (x is a member record; kind 4 is not named by the spec). */
function dominates(x: Rec, y: Rec, s: MState): boolean {
  if (x.kind !== KIND.member) return false;
  return eq(targetPid(x), y.author) && (x.payload.get(3) as number) < roleOf(s, y.author);
}

export function resolveMembership(gid: Uint8Array, recs: Rec[]): Membership {
  const m: Membership = { chain: [], ignored: new Map(), epoch: 0, roles: new Map(), writersByEpoch: new Map(),
                          managersByEpoch: new Map(), cuts: [], pendingEpoch: [], genesisFork: false, forks: [] };
  const mine = recs.filter((r) => eq(r.gid, gid) && MEMBERSHIP_KINDS.includes(r.kind));
  const geneses = mine.filter((r) => r.kind === KIND.genesis);
  const good: Rec[] = [];
  for (const g of geneses) {
    const p = genesisProblem(g);
    if (p) m.ignored.set(hex(g.id), p); else good.push(g);
  }
  if (good.length > 1) { m.genesisFork = true; return m; }
  if (good.length === 0) return m;
  const st: MState = { epoch: 0, roles: new Map([[hex(good[0]!.author), 3]]), commits: new Map([[0, good[0]!.payload.get(3) as Uint8Array]]) };
  const touch = () => {
    for (const [pid, role] of st.roles) {
      if (role >= 2) { if (!m.writersByEpoch.has(st.epoch)) m.writersByEpoch.set(st.epoch, new Set()); m.writersByEpoch.get(st.epoch)!.add(pid); }
      if (role >= 3) { if (!m.managersByEpoch.has(st.epoch)) m.managersByEpoch.set(st.epoch, new Set()); m.managersByEpoch.get(st.epoch)!.add(pid); }
    }
  };
  m.chain.push(good[0]!);
  touch();
  const others = mine.filter((r) => r.kind !== KIND.genesis);
  let head = good[0]!;
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
      const free = valid.filter((x) => !valid.some((y) => y !== x && dominates(y, x, st)));
      const pool = free.length ? free : valid;
      pool.sort((a, b) => cmp(a.id, b.id));
      winner = pool[0]!;
      const rule = free.length === 0 ? 'cycle_smaller_record_id' : free.length < valid.length ? 'removes_or_lowers' : 'smaller_record_id';
      m.forks.push({ mprev: hex(head.id), winner: hex(winner.id), losers: valid.filter((x) => x !== winner).map((x) => hex(x.id)), rule });
      for (const l of valid) if (l !== winner) m.ignored.set(hex(l.id), 'lost_fork');
    }
    apply(winner, st, m);
    m.chain.push(winner);
    touch();
    head = winner;
  }
  // 6.3, 6.4: a removal or replacement MUST be followed in the chain by an epoch record from the same author.
  m.chain.forEach((r, i) => {
    // 6.3 says "from the same author" for a removal; 6.4 says only "an epoch record" for a replacement (finding).
    const removal = r.kind === KIND.member && (r.payload.get(3) as number) === 0;
    const followed = m.chain.slice(i + 1).some((x) => x.kind === KIND.epoch && (r.kind === KIND.replace || eq(x.author, r.author)));
    if ((removal || r.kind === KIND.replace) && !followed) m.pendingEpoch.push(hex(r.id));
  });
  m.epoch = st.epoch;
  m.roles = st.roles;
  const placed = new Set(m.chain.map((r) => hex(r.id)));
  for (const r of others) if (!placed.has(hex(r.id)) && !m.ignored.has(hex(r.id))) m.ignored.set(hex(r.id), 'off_chain');
  return m;
}

function apply(r: Rec, s: MState, m: Membership): void {
  if (r.kind === KIND.member) {
    const t = r.payload.get(2);
    const pid = t instanceof Uint8Array ? t : (t as CMap).get(1) as Uint8Array;
    const role = r.payload.get(3) as number;
    const old = roleOf(s, pid);
    if (role < old) {
      const cut = new Map<string, number>();
      for (const c of r.payload.get(4) as [Uint8Array, number][]) cut.set(hex(c[0]), c[1]);
      m.cuts.push({ pid: hex(pid), record: hex(r.id), cut });
    }
    s.roles.set(hex(pid), role);
  } else if (r.kind === KIND.epoch) {
    s.epoch = r.payload.get(2) as number;
    s.commits.set(s.epoch, r.payload.get(3) as Uint8Array);
  } else if (r.kind === KIND.replace) {
    const old = r.payload.get(2) as Uint8Array;
    const nu = (r.payload.get(3) as CMap).get(1) as Uint8Array;
    s.roles.set(hex(nu), roleOf(s, old));
    s.roles.set(hex(old), 0);
  }
}

// ---------------------------------------------------------------- section 9 step 4 for content records

export type Status = 'accepted' | 'waits' | `ignored:${string}`;

/** 6.5: a content record is accepted when its author was a writer or manager at some point in its epoch and it is not
 *  beyond a cut. A cut lists the last accepted record per chain; a chain it does not list is entirely beyond it. */
export function contentStatus(m: Membership, r: Rec, needManager = false): Status {
  if (r.epoch > m.epoch) return 'waits';
  const who = hex(r.author);
  const set = (needManager ? m.managersByEpoch : m.writersByEpoch).get(r.epoch);
  if (!set || !set.has(who)) return needManager ? 'ignored:not_manager' : 'ignored:not_writer';
  for (const c of m.cuts) {
    if (c.pid === who && r.seq > (c.cut.get(hex(r.device)) ?? 0)) return 'ignored:beyond_cut';
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

/** The whole reader. Section 9 puts the role check (4) before the chain check (5), but a membership record's own chain
 *  must be accepted before it can grant a role, and a checkpoint can bridge a chain: so this iterates to a fixed point. */
export function evaluateGroup(gid: Uint8Array, all: Rec[], nowMs?: number): GroupView {
  const mine = all.filter((r) => eq(r.gid, gid));
  const held = nowMs === undefined ? [] : mine.filter((r) => heldBack(r.wall, nowMs));
  const recs = mine.filter((r) => !held.includes(r));
  let covered: Covered = new Map();
  let chains!: ChainResult, membership!: Membership, cps: Rec[] = [];
  for (let i = 0; i < recs.length + 3; i++) {
    chains = acceptChains(recs, covered);
    membership = resolveMembership(gid, chains.accepted);
    const ids = new Set(membership.chain.map((r) => hex(r.id)));
    cps = chains.accepted.filter((r) => r.kind === KIND.checkpoint && contentStatus(membership, r, true) === 'accepted'
      && ids.has(hex(r.payload.get(2) as Uint8Array)));
    const next = mergeCovered(cps);
    if (sameCovered(next, covered)) break;
    covered = next;
    if (i === recs.length + 2) throw new Error('reader did not converge');
  }
  const content = chains.accepted.filter((r) => r.kind !== KIND.checkpoint && !MEMBERSHIP_KINDS.includes(r.kind))
    .map((rec) => ({ rec, status: contentStatus(membership, rec) }));
  const changes = content.filter((c) => c.rec.kind === KIND.item && c.status === 'accepted').map((c) => c.rec)
    .filter((r) => { const cv = covered.get(chainKey(r)); return !cv || r.seq > cv.seq; });
  const state = fold(sortRecords(changes), cps.map((c) => c.payload.get(3) as CborValue[]));
  return { accepted: chains.accepted, chains, membership, checkpoints: cps, covered, content, held, state };
}

export { CborError };
