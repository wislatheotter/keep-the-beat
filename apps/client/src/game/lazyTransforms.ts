import { Object3D } from 'three';

type Tracked = Object3D & {
  _composed?: Float64Array;
  _placed?: number;
  _under?: Object3D | null;
  _underPlaced?: number;
};

const proto = Object3D.prototype as Tracked;
const compose = proto.updateMatrix;

proto.updateMatrix = function updateMatrix(this: Tracked) {
  if (this.pivot) { compose.call(this); return; }
  const p = this.position, q = this.quaternion, s = this.scale;
  let seen = this._composed;
  if (seen === undefined) {
    seen = new Float64Array(10);
    this._composed = seen;
  } else if (seen[0] === p.x && seen[1] === p.y && seen[2] === p.z
    && seen[3] === q.x && seen[4] === q.y && seen[5] === q.z && seen[6] === q.w
    && seen[7] === s.x && seen[8] === s.y && seen[9] === s.z) {
    return;
  }
  seen[0] = p.x; seen[1] = p.y; seen[2] = p.z;
  seen[3] = q.x; seen[4] = q.y; seen[5] = q.z; seen[6] = q.w;
  seen[7] = s.x; seen[8] = s.y; seen[9] = s.z;
  compose.call(this);
};

function reparented(object: Tracked, parent: Tracked | null) {
  const placed = parent === null ? 0 : parent._placed;
  if (object._under === parent && object._underPlaced === placed) return false;
  object._under = parent;
  object._underPlaced = placed;
  return true;
}

proto.updateMatrixWorld = function updateMatrixWorld(this: Tracked, force?: boolean) {
  if (this.matrixAutoUpdate) this.updateMatrix();
  const parent = this.parent as Tracked | null;
  if (reparented(this, parent)) this.matrixWorldNeedsUpdate = true;
  if (this.matrixWorldNeedsUpdate || force) {
    if (this.matrixWorldAutoUpdate === true) {
      if (parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(parent.matrixWorld, this.matrix);
    }
    this._placed = (this._placed ?? 0) + 1;
    this.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = this.children;
  for (let i = 0, l = children.length; i < l; i += 1) children[i]!.updateMatrixWorld(force);
};

proto.updateWorldMatrix = function updateWorldMatrix(this: Tracked, updateParents: boolean, updateChildren: boolean, force = false) {
  const parent = this.parent as Tracked | null;
  if (updateParents === true && parent !== null) parent.updateWorldMatrix(true, false);
  if (this.matrixAutoUpdate) this.updateMatrix();
  if (reparented(this, parent)) this.matrixWorldNeedsUpdate = true;
  if (this.matrixWorldNeedsUpdate || force) {
    if (this.matrixWorldAutoUpdate === true) {
      if (parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(parent.matrixWorld, this.matrix);
    }
    this._placed = (this._placed ?? 0) + 1;
    this.matrixWorldNeedsUpdate = false;
    force = true;
  }
  if (updateChildren === true) {
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i += 1) children[i]!.updateWorldMatrix(false, true, force);
  }
};

const copy = proto.copy;
proto.copy = function (this: Tracked, source: Object3D, recursive?: boolean) {
  copy.call(this, source, recursive);
  this._composed = undefined;
  this._under = undefined;
  return this;
};
