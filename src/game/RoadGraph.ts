import * as THREE from 'three';
import type { AABBCollider } from '../graphics/OpenWorldMap';

const NO_OCCLUDERS: readonly AABBCollider[] = [];

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  z: number;
  neighbors: number[];
}

/**
 * Connected road graph covering Neo Velo's avenues, streets, GP connectors,
 * Harbor strip, and Mountain Touge summit so police and city traffic navigate
 * around buildings instead of ramming walls.
 */
export class RoadGraph {
  public readonly nodes: RoadNode[] = [];

  constructor() {
    const add = (x: number, y: number, z: number): number => {
      const id = this.nodes.length;
      this.nodes.push({ id, x, y, z, neighbors: [] });
      return id;
    };
    const connect = (a: number, b: number) => {
      if (!this.nodes[a].neighbors.includes(b)) this.nodes[a].neighbors.push(b);
      if (!this.nodes[b].neighbors.includes(a)) this.nodes[b].neighbors.push(a);
    };

    // Main City Grid: avenues [46, 122, 224, 296] x streets [-160, -40, 30, 150, 224]
    const avs = [46, 122, 224, 296];
    const sts = [-160, -40, 30, 150, 224];
    const grid: number[][] = [];
    for (let ai = 0; ai < avs.length; ai++) {
      grid[ai] = [];
      for (let si = 0; si < sts.length; si++) {
        grid[ai][si] = add(avs[ai], 0, sts[si]);
      }
    }
    for (let ai = 0; ai < avs.length; ai++) {
      for (let si = 0; si < sts.length; si++) {
        if (ai + 1 < avs.length) connect(grid[ai][si], grid[ai + 1][si]);
        if (si + 1 < sts.length) connect(grid[ai][si], grid[ai][si + 1]);
      }
    }

    // GP Track Straight & Connectors (z = -160, -40, 30 at x = 2)
    const gpN = add(2, 0, -160);
    const gpM = add(2, 0, -40);
    const gpS = add(2, 0, 30);
    connect(gpN, gpM);
    connect(gpM, gpS);
    connect(gpN, grid[0][0]); // (2,-160) <-> (46,-160)
    connect(gpM, grid[0][1]); // (2,-40)  <-> (46,-40)
    connect(gpS, grid[0][2]); // (2,30)   <-> (46,30)

    // Mountain Touge Loop: (32,-160) -> (32,-296) -> (155,6,-296) -> (278,-296) -> (278,-160)
    const tWBase = add(32, 0, -160);
    const tWTop = add(32, 0, -296);
    const tSummit = add(155, 6, -296);
    const tETop = add(278, 0, -296);
    const tEBase = add(278, 0, -160);
    connect(tWBase, grid[0][0]);
    connect(tWBase, tWTop);
    connect(tWTop, tSummit);
    connect(tSummit, tETop);
    connect(tETop, tEBase);
    connect(tEBase, grid[2][0]);
    connect(tEBase, grid[3][0]);

    // Harbor Quay East & West access (x=84, 168, 256 at z=240)
    const hW = add(84, 0, 240);
    const hC = add(168, 0, 240);
    const hE = add(256, 0, 240);
    connect(hW, grid[0][4]);
    connect(hW, grid[1][4]);
    connect(hW, hC);
    connect(hC, grid[1][4]);
    connect(hC, grid[2][4]);
    connect(hC, hE);
    connect(hE, grid[2][4]);
    connect(hE, grid[3][4]);
  }

  public nearestNodeId(x: number, z: number): number {
    let best = 0;
    let bestDistSq = Infinity;
    for (const n of this.nodes) {
      const dSq = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = n.id;
      }
    }
    return best;
  }

  /**
   * Returns the next road intersection coordinate to steer toward when navigating
   * from `from` to `to` across the city street network.
   */
  public findNextWaypoint(from: THREE.Vector3, to: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const startId = this.nearestNodeId(from.x, from.z);
    const goalId = this.nearestNodeId(to.x, to.z);
    if (startId === goalId) {
      return out.copy(to);
    }

    const nCount = this.nodes.length;
    const dist = new Float64Array(nCount).fill(Infinity);
    const prev = new Int32Array(nCount).fill(-1);
    const visited = new Uint8Array(nCount);
    dist[startId] = 0;

    for (let iter = 0; iter < nCount; iter++) {
      let u = -1;
      let bestD = Infinity;
      for (let i = 0; i < nCount; i++) {
        if (!visited[i] && dist[i] < bestD) {
          bestD = dist[i];
          u = i;
        }
      }
      if (u === -1 || u === goalId) break;
      visited[u] = 1;

      const nu = this.nodes[u];
      for (const v of nu.neighbors) {
        if (visited[v]) continue;
        const nv = this.nodes[v];
        const edgeCost = Math.hypot(nv.x - nu.x, nv.z - nu.z);
        if (dist[u] + edgeCost < dist[v]) {
          dist[v] = dist[u] + edgeCost;
          prev[v] = u;
        }
      }
    }

    // Walk back from goal to find the first step after startId
    let step = goalId;
    while (prev[step] !== -1 && prev[step] !== startId) {
      step = prev[step];
    }

    // If startNode is already behind us relative to the next node, advance directly
    const startNode = this.nodes[startId];
    const nextNode = this.nodes[step];
    const dToStart = Math.hypot(startNode.x - from.x, startNode.z - from.z);
    if (dToStart < 14 && prev[step] === startId) {
      return out.set(nextNode.x, nextNode.y, nextNode.z);
    }
    return out.set(startNode.x, startNode.y, startNode.z);
  }

  /**
   * Steer around an obstacle when both endpoints fall into the same road cell.
   * `findNextWaypoint()` returns the raw goal there, which is exactly wrong
   * when the direct segment is known to be blocked. Prefer a neighbouring
   * intersection with a clear run from both ends.
   */
  public findBlockedWaypoint(
    from: THREE.Vector3,
    to: THREE.Vector3,
    colliders: readonly AABBCollider[],
    out = new THREE.Vector3()
  ): THREE.Vector3 {
    const startId = this.nearestNodeId(from.x, from.z);
    if (startId !== this.nearestNodeId(to.x, to.z)) return this.findNextWaypoint(from, to, out);

    const node = this.nodes[startId];
    let bestId = -1;
    let bestCost = Infinity;
    for (const v of node.neighbors) {
      const n = this.nodes[v];
      if (!hasLineOfSight(from.x, from.z, n.x, n.z, colliders, 1.6)) continue;
      if (!hasLineOfSight(n.x, n.z, to.x, to.z, colliders, 1.6)) continue;
      const cost = Math.hypot(from.x - n.x, from.z - n.z) + Math.hypot(n.x - to.x, n.z - to.z);
      if (cost < bestCost) { bestCost = cost; bestId = v; }
    }
    if (bestId < 0) {
      // Narrow alleys can hide every adjacent intersection behind a corner.
      // Widen the search to any road node we can actually see, preferring the
      // one closest to the target; this is still far safer than the raw goal.
      for (const padding of [1.6, 0.3]) {
        for (const n of this.nodes) {
          if (!hasLineOfSight(from.x, from.z, n.x, n.z, colliders, padding)) continue;
          const cost = Math.hypot(n.x - to.x, n.z - to.z)
            + 0.15 * Math.hypot(from.x - n.x, from.z - n.z);
          if (cost < bestCost) { bestCost = cost; bestId = n.id; }
        }
        if (bestId >= 0) break;
      }
    }
    if (bestId < 0) {
      // No visible node at all — still leave the shared cell rather than
      // pointing straight into the obstacle that broke line-of-sight.
      for (const v of node.neighbors) {
        const n = this.nodes[v];
        const cost = Math.hypot(from.x - n.x, from.z - n.z) + Math.hypot(n.x - to.x, n.z - to.z);
        if (cost < bestCost) { bestCost = cost; bestId = v; }
      }
    }
    if (bestId >= 0) {
      const n = this.nodes[bestId];
      return out.set(n.x, n.y, n.z);
    }
    return out.copy(to);
  }
}

/**
 * 2D segment-vs-AABB line-of-sight test against city buildings & solid blocks.
 * Returns true if the line between `a` and `b` is unobstructed.
 */
export function hasLineOfSight(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  colliders: readonly AABBCollider[],
  padding = 0.2,
  ay = 0,
  by = 0,
  extraOccluders: readonly AABBCollider[] = NO_OCCLUDERS
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const total = colliders.length + extraOccluders.length;
  for (let i = 0; i < total; i++) {
    // Elevated decks/ramps are supplied separately; no array allocation here
    // because this runs for every police unit on every frame.
    const c = i < colliders.length ? colliders[i] : extraOccluders[i - colliders.length];
    if (c.height < 2.2) continue;
    const minX = c.minX - padding;
    const maxX = c.maxX + padding;
    const minZ = c.minZ - padding;
    const maxZ = c.maxZ + padding;

    let tMin = 0;
    let tMax = 1;

    if (Math.abs(dx) < 1e-6) {
      if (ax < minX || ax > maxX) continue;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - ax) * inv;
      let t2 = (maxX - ax) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    if (Math.abs(dz) < 1e-6) {
      if (az < minZ || az > maxZ) continue;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - az) * inv;
      let t2 = (maxZ - az) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) continue;
    }

    // A segment passing above a short block (or over the 6m Touge deck) is a
    // clear shot. Sample both ends of the overlap so a line that clips the
    // top of a rising ramp still counts as blocked.
    const enterY = ay + (by - ay) * THREE.MathUtils.clamp(tMin, 0, 1);
    const exitY = ay + (by - ay) * THREE.MathUtils.clamp(tMax, 0, 1);
    if (Math.min(enterY, exitY) > c.height - 0.1) continue;

    return false;
  }
  return true;
}
