'use strict';

/** Pure deterministic table physics. Coordinates are pixels; step time is seconds.
 * const game = new PhysicsEngine({ table: { x: 0, y: 0, width: 1920, height: 1032 } });
 * game.step(1 / 60, { x: 300, y: 400, radius: 40 }); // returns events
 * game.snapshot(); // detached render/state data; never mutates the sampled cue
 * dt is capped at .25s (a time-dropped event reports excess); <=256 substeps.
 * Cue samples are swept continuously, even across arbitrarily long movements.
 * Colored-ball speed is bounded by the substep budget, preventing tunneling.
 * Optional balls overrides the initial nine-ball rack (for fixtures); balls are copied.
 * roundLayout: 'original' also restores those seeds on reset/rerack, including folder metadata.
 * clearDelay is the nonnegative seconds before automatic rerack (default 1.2).
 */
const MULTIPLIERS = Object.freeze([1, 1.3, 1.6, 2]);
const MAX_DT = 0.25;
const MAX_SUBSTEPS = 256;
const EPS = 1e-9;
function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be finite');
  return value;
}
function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(name + ' must be positive');
  return value;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
/** Earliest t in [0,1] where a segment enters a circle, or null. */
function segmentCircle(ax, ay, bx, by, cx, cy, radius) {
  const x = ax - cx, y = ay - cy, dx = bx - ax, dy = by - ay;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < EPS) return null;
  const b = x * dx + y * dy, disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

class PhysicsEngine {
  #roundSeed = null;
  constructor(options = {}) {
    const t = options.table || {};
    this.table = { x: finite(t.x ?? 0, 'table.x'), y: finite(t.y ?? 0, 'table.y'),
      width: positive(t.width ?? 1920, 'table.width'), height: positive(t.height ?? 1032, 'table.height') };
    const short = Math.min(this.table.width, this.table.height);
    this.radius = positive(options.ballRadius ?? short * .016 * (options.ballScale ?? 1), 'ballRadius');
    if (this.radius * 12 >= short) throw new RangeError('ballRadius too large for table');
    this.pocketRadius = positive(options.pocketRadius ?? this.radius * 1.8 * (options.pocketScale ?? 1), 'pocketRadius');
    this.borderWidth = this.radius * 3;
    this.friction = finite(options.friction ?? .55, 'friction');
    if (this.friction < 0) throw new RangeError('friction must be nonnegative');
    this.wallRestitution = clamp(finite(options.wallRestitution ?? .82, 'wallRestitution'), 0, 1);
    this.ballRestitution = clamp(finite(options.ballRestitution ?? .95, 'ballRestitution'), 0, 1);
    this.cueTransfer = clamp(finite(options.cueTransfer ?? 1, 'cueTransfer'), 0, 2);
    this.stopSpeed = positive(options.stopSpeed ?? 2, 'stopSpeed');
    this.roundLayout = options.roundLayout === 'original' ? 'original' : 'nine';
    this.clearDelay = finite(options.clearDelay ?? 1.2, 'clearDelay');
    if (this.clearDelay < 0) throw new RangeError('clearDelay must be nonnegative');
    const { x, y, width: w, height: h } = this.table;
    this.pockets = [[x,y],[x+w/2,y],[x+w,y],[x,y+h],[x+w/2,y+h],[x+w,y+h]]
      .map(([px,py], id) => ({ id, x: px, y: py, radius: this.pocketRadius }));
    this.breakPoint = { x: x + w / 4, y: y + h / 2 };
    this.time = 0; this.score = 0; this.roundScore = 0; this.rounds = 0; this.round = 1;
    this.combo = 0; this.lastPocketTime = -Infinity; this.cleared = false;
    this.clearAt = Infinity; this.previousCue = null; this.scratchLatched = false;
    this.ownedCue=options.ownedCue===true;this.cueRadius=positive(options.cueRadius??this.radius,'cueRadius');
    if(this.cueRadius*2>=short)throw new RangeError('cueRadius too large');
    this.gravity=finite(options.gravity??0,'gravity');this.needsPlacement=false;
    this.balls = options.balls ? this.copyBalls(options.balls) : this.rack();
    if(this.ownedCue){this.cue={...this.breakPoint,radius:this.cueRadius,vx:0,vy:0,pocketed:false};this.resetCue();}
    if (this.roundLayout === 'original') {
      this.#roundSeed = this.copyBalls(this.balls).map(b => ({ ...b, vx: 0, vy: 0, pocketed: false }));
    }
  }
  copyBalls(balls) {
    if (!Array.isArray(balls) || !balls.length) throw new TypeError('balls must be a nonempty array');
    const ids = new Set();
    return balls.map((b, i) => {
      const id = b.id ?? i + 1;
      if (ids.has(id)) throw new TypeError('ball ids must be unique');
      ids.add(id);
      const radius = positive(b.radius ?? this.radius, 'ball.radius');
      if (radius * 2 >= Math.min(this.table.width, this.table.height)) throw new RangeError('ball too large');
      const ball = { id, x: finite(b.x, 'ball.x'), y: finite(b.y, 'ball.y'),
        vx: finite(b.vx ?? 0, 'ball.vx'), vy: finite(b.vy ?? 0, 'ball.vy'), radius, pocketed: !!b.pocketed,
        ...(typeof b.name==='string'?{name:b.name}:{}),...(typeof b.sourceId==='string'?{sourceId:b.sourceId}:{}),
        ...(b.home?{home:{x:finite(b.home.x,'ball.home.x'),y:finite(b.home.y,'ball.home.y')}}:{}),
        ...(typeof b.iconDataUrl==='string'?{iconDataUrl:b.iconDataUrl}:{}) };
      return ball;
    });
  }
  rack() {
    const { x, y, width: w, height: h } = this.table;
    const result = [], rows = [1, 2, 3, 2, 1], gap = this.radius * 2.1;
    let id = 1;
    rows.forEach((count, col) => {
      for (let i = 0; i < count; i++) result.push({ id: id++, x: x + w * .65 + (col - 2) * gap,
        y: y + h / 2 + (i - (count - 1) / 2) * gap, vx: 0, vy: 0, radius: this.radius, pocketed: false });
    });
    return result;
  }
  /** Reset the rack and combo; accumulated score and completed rounds survive. */
  resetRound() {
    this.balls = this.#roundSeed ? this.copyBalls(this.#roundSeed) : this.rack();
    this.roundScore = 0; this.combo = 0;
    this.lastPocketTime = -Infinity; this.cleared = false; this.clearAt = Infinity;
    this.previousCue = null; this.scratchLatched = false;
    if(this.ownedCue)this.resetCue();
  }
  snapshot() {
    return { ...(this.ownedCue?{cue:{...this.cue},cueSource:'owned',canShoot:this.canShoot,needsPlacement:this.needsPlacement}:{}),table: { ...this.table }, pockets: this.pockets.map(p => ({ ...p })),
      balls: this.balls.map(b => ({ ...b, ...(b.home == null ? {} : { home: { ...b.home } }) })),
      score: this.score, roundScore: this.roundScore,
      combo: this.combo, multiplier: MULTIPLIERS[Math.min(Math.max(this.combo - 1, 0), 3)],
      rounds: this.rounds, round: this.round, time: this.time, cleared: this.cleared,
      totalBalls:this.balls.length,clearDelay:this.clearDelay,clearAt:this.clearAt,
      remaining: this.balls.filter(b => !b.pocketed).length, radius: this.radius,
      borderWidth: this.borderWidth, breakPoint: { ...this.breakPoint } };
  }
  get canShoot(){return !!this.ownedCue&&!this.cue.pocketed&&[this.cue,...this.balls.filter(b=>!b.pocketed)].every(b=>Math.hypot(b.vx,b.vy)<=this.stopSpeed*1.5);}
  validCuePoint(x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y))return false;const t=this.table,r=this.cueRadius;
    return x>=t.x+r&&x<=t.x+t.width-r&&y>=t.y+r&&y<=t.y+t.height-r&&!this.pockets.some(p=>Math.hypot(x-p.x,y-p.y)<p.radius+r)&&!this.balls.some(b=>!b.pocketed&&Math.hypot(x-b.x,y-b.y)<r+b.radius+2);
  }
  findCuePoint(){
    if(this.validCuePoint(this.breakPoint.x,this.breakPoint.y))return {...this.breakPoint};
    const t=this.table,r=this.cueRadius,step=r*2+6;
    for(let y=t.y+r+5;y<t.y+t.height-r;y+=step)for(let x=t.x+r+5;x<t.x+t.width-r;x+=step)if(this.validCuePoint(x,y))return {x,y};
    return null;
  }
  resetCue(){const point=this.findCuePoint();this.cue={...(point||this.breakPoint),radius:this.cueRadius,vx:0,vy:0,pocketed:!point};this.needsPlacement=!point;}
  placeCue(x,y){if(!this.ownedCue||!this.validCuePoint(x,y))return false;Object.assign(this.cue,{x,y,vx:0,vy:0,pocketed:false});this.needsPlacement=false;return true;}
  shoot(angle,power){finite(angle,'angle');positive(power,'power');if(!this.canShoot)return false;const speed=1200*Math.min(3.5,power),radians=angle*Math.PI/180;this.cue.vx=Math.cos(radians)*speed;this.cue.vy=-Math.sin(radians)*speed;return true;}
  throwCue(vx,vy){finite(vx,'vx');finite(vy,'vy');if(!this.ownedCue||this.cue.pocketed)return false;const speed=Math.hypot(vx,vy),scale=speed>4200?4200/speed:1;this.cue.vx=vx*scale;this.cue.vy=vy*scale;return true;}
  stepOwned(dt){
    finite(dt,'dt');if(dt<0)throw new RangeError('dt must be nonnegative');const events=[];if(dt===0)return events;
    if(dt>MAX_DT)events.push({type:'time-dropped',seconds:dt-MAX_DT});dt=Math.min(dt,MAX_DT);
    const all=[this.cue,...this.balls],minRadius=Math.min(...all.map(b=>b.radius));
    const cap=(b,maximum)=>{const speed=Math.hypot(b.vx,b.vy);if(speed>maximum){b.vx*=maximum/speed;b.vy*=maximum/speed;}};
    const maximum=minRadius*.5*MAX_SUBSTEPS/dt;all.forEach(b=>cap(b,maximum));
    const speed=Math.max(...all.map(b=>Math.hypot(b.vx,b.vy)));const steps=Math.max(1,Math.min(MAX_SUBSTEPS,Math.ceil(Math.max(dt*120,speed*dt/(minRadius*.5))))),h=dt/steps;
    for(let k=0;k<steps;k++){
      this.time+=h;
      if(this.cleared){if(this.time+EPS>=this.clearAt){this.round++;this.resetRound();events.push({type:'round-start',round:this.round});}continue;}
      const active=[this.cue,...this.balls].filter(b=>!b.pocketed);
      for(const b of active){
        if(b===this.cue&&this.gravity>0){const floor=this.table.y+this.table.height-b.radius;if(b.y<floor-.5||Math.abs(b.vy)>40)b.vy+=this.gravity*h;else b.vy=0;}
        const x=b.x+b.vx*h,y=b.y+b.vy*h,hit=this.pocketAt(b.x,b.y,x,y);b.x=x;b.y=y;
        if(hit){if(b===this.cue){b.pocketed=true;b.vx=b.vy=0;const penalty=Math.min(20,this.score);this.score-=penalty;this.roundScore=Math.max(0,this.roundScore-20);this.combo=0;this.lastPocketTime=-Infinity;events.push({type:'scratch',penalty,pocketId:hit.pocket.id,position:{...this.breakPoint}});}else this.scoreBall(b,hit.pocket,events);}else this.walls(b);
      }
      for(let pass=0;pass<3;pass++)for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(!active[i].pocketed&&!active[j].pocketed)this.collide(active[i],active[j]);
      for(const b of active)if(!b.pocketed){this.walls(b);cap(b,maximum);const decay=Math.exp(-this.friction*h);b.vx*=decay;b.vy*=decay;if(Math.hypot(b.vx,b.vy)<this.stopSpeed)b.vx=b.vy=0;}
      if(this.cue.pocketed&&this.balls.every(b=>b.pocketed||Math.hypot(b.vx,b.vy)<this.stopSpeed)){const point=this.findCuePoint();if(point)this.placeCue(point.x,point.y);else this.needsPlacement=true;}
      if(this.balls.every(b=>b.pocketed)){this.cleared=true;this.clearAt=this.time+this.clearDelay;this.rounds++;events.push({type:'clear',round:this.round,roundScore:this.roundScore,score:this.score});}
    }
    return events;
  }
  pocketAt(ax, ay, bx, by, tolerance = 1) {
    let best = null;
    for (const p of this.pockets) {
      const t = segmentCircle(ax, ay, bx, by, p.x, p.y, p.radius * tolerance);
      if (t !== null && (!best || t < best.t)) best = { pocket: p, t };
    }
    return best;
  }
  scoreBall(ball, pocket, events) {
    ball.pocketed = true; ball.vx = ball.vy = 0;
    this.combo = this.time - this.lastPocketTime < 8 - EPS ? this.combo + 1 : 1;
    this.lastPocketTime = this.time;
    const points = Math.round(10 * MULTIPLIERS[Math.min(this.combo - 1, 3)]);
    this.score += points; this.roundScore += points;
    events.push({ type: 'pocket', ballId: ball.id, pocketId: pocket.id, points, combo: this.combo });
  }
  walls(b) {
    const t = this.table, r = b.radius;
    if (b.x < t.x+r) { b.x=t.x+r; if (b.vx<0) b.vx *= -this.wallRestitution; }
    if (b.x > t.x+t.width-r) { b.x=t.x+t.width-r; if (b.vx>0) b.vx *= -this.wallRestitution; }
    if (b.y < t.y+r) { b.y=t.y+r; if (b.vy<0) b.vy *= -this.wallRestitution; }
    if (b.y > t.y+t.height-r) { b.y=t.y+t.height-r; if (b.vy>0) b.vy *= -this.wallRestitution; }
  }
  collide(a, b) {
    let dx=b.x-a.x, dy=b.y-a.y, distance=Math.hypot(dx,dy), r=a.radius+b.radius;
    if (distance >= r) return;
    const nx=distance>EPS?dx/distance:1, ny=distance>EPS?dy/distance:0;
    const overlap=(r-distance)/2;
    a.x-=nx*overlap; a.y-=ny*overlap; b.x+=nx*overlap; b.y+=ny*overlap;
    const closing=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
    if (closing<=0) return;
    const impulse=(1+this.ballRestitution)*closing/2;
    a.vx-=impulse*nx; a.vy-=impulse*ny; b.vx+=impulse*nx; b.vy+=impulse*ny;
  }
  /** Consume one frame. cue=null breaks tracking; first sample never teleports a shot.
   * Optional cue vx/vy overrides inferred velocity (pixels/s), not swept endpoints.
   * scratch requests external cue repositioning; repeated in-pocket samples latch.
   */
  step(dt, cue = null) {
    if(this.ownedCue){if(cue!==null)throw new TypeError('Owned cue cannot use external window samples');return this.stepOwned(dt);}
    finite(dt, 'dt'); if (dt < 0) throw new RangeError('dt must be nonnegative');
    let current = null;
    if (cue) current = { x: finite(cue.x,'cue.x'), y: finite(cue.y,'cue.y'),
      radius: positive(cue.radius ?? this.radius,'cue.radius'),
      ...(cue.vx == null ? {} : { vx: finite(cue.vx,'cue.vx') }),
      ...(cue.vy == null ? {} : { vy: finite(cue.vy,'cue.vy') }) };
    const events=[];
    if (dt === 0) return events;
    if (dt > MAX_DT) events.push({ type:'time-dropped', seconds:dt-MAX_DT });
    dt=Math.min(dt,MAX_DT);
    const start=this.previousCue || current;
    const cvx=current ? current.vx ?? (current.x-start.x)/dt : 0;
    const cvy=current ? current.vy ?? (current.y-start.y)/dt : 0;
    let scratch=false;
    if (current) {
      // The desktop pet is much larger than a colored ball: capture when its body reaches a pocket.
      const tolerance=Math.max(1.3,1+current.radius/this.pocketRadius);
      const hit=this.pocketAt(start.x,start.y,current.x,current.y,tolerance);
      if (hit && !this.scratchLatched) {
        const penalty=Math.min(20,this.score); this.score-=penalty;
        this.roundScore=Math.max(0,this.roundScore-20); this.combo=0; this.lastPocketTime=-Infinity;
        events.push({ type:'scratch', penalty, pocketId:hit.pocket.id, position:{...this.breakPoint} });
        this.scratchLatched=true; scratch=true;
      } else if (!hit) this.scratchLatched=false;
    } else this.scratchLatched=false;
    // Fixed bounded work: every ball travels <= half the smallest ball radius per substep.
    const minRadius=Math.min(...this.balls.map(b=>b.radius));
    const speedLimit=minRadius*.5*MAX_SUBSTEPS/dt;
    const cap=b=>{ const s=Math.hypot(b.vx,b.vy); if(s>speedLimit) { b.vx*=speedLimit/s; b.vy*=speedLimit/s; } };
    this.balls.forEach(cap);
    const potential=Math.max(Math.hypot(cvx,cvy)*this.cueTransfer*2,
      ...this.balls.map(b=>Math.hypot(b.vx,b.vy)));
    const steps=Math.max(1,Math.min(MAX_SUBSTEPS,Math.ceil(Math.max(dt*120,potential*dt/(minRadius*.5)))));
    // Use the actual chosen budget for subsequent impulses too.
    const actualLimit=minRadius*.5*steps/dt;
    const limit=b=>{const s=Math.hypot(b.vx,b.vy);if(s>actualLimit){b.vx*=actualLimit/s;b.vy*=actualLimit/s;}};
    const h=dt/steps;
    for(let k=0;k<steps;k++) {
      this.time+=h;
      if(this.cleared) {
        if(this.time+EPS>=this.clearAt) {this.round++;this.resetRound();events.push({type:'round-start',round:this.round});}
        continue;
      }
      const active=this.balls.filter(b=>!b.pocketed);
      for(const b of active) {
        let bx=b.x+b.vx*h, by=b.y+b.vy*h;
        if(current && !scratch) {
          const ax=start.x+(current.x-start.x)*k/steps, ay=start.y+(current.y-start.y)*k/steps;
          const ex=start.x+(current.x-start.x)*(k+1)/steps, ey=start.y+(current.y-start.y)*(k+1)/steps;
          const hit=segmentCircle(ax-b.x,ay-b.y,ex-bx,ey-by,0,0,current.radius+b.radius);
          if(hit!==null) {
            const nx0=(b.x+(bx-b.x)*hit)-(ax+(ex-ax)*hit);
            const ny0=(b.y+(by-b.y)*hit)-(ay+(ey-ay)*hit);
            const len=Math.hypot(nx0,ny0), speed=Math.hypot(cvx,cvy);
            const nx=len>EPS?nx0/len:(speed>EPS?cvx/speed:1), ny=len>EPS?ny0/len:(speed>EPS?cvy/speed:0);
            const closing=(cvx-b.vx)*nx+(cvy-b.vy)*ny;
            if(closing>0) {
              b.vx+=closing*nx*this.cueTransfer; b.vy+=closing*ny*this.cueTransfer; limit(b);
              bx=b.x+b.vx*h; by=b.y+b.vy*h;
            }
          }
        }
        const pocket=this.pocketAt(b.x,b.y,bx,by);
        b.x=bx;b.y=by;
        if(pocket) this.scoreBall(b,pocket.pocket,events);
        else this.walls(b);
      }
      // Multiple passes stabilize initial overlaps and simultaneous contacts.
      for(let pass=0;pass<3;pass++) for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++)
        if(!active[i].pocketed&&!active[j].pocketed) this.collide(active[i],active[j]);
      for(const b of active) if(!b.pocketed) {
        this.walls(b);limit(b);
        const decay=Math.exp(-this.friction*h);b.vx*=decay;b.vy*=decay;
        if(Math.hypot(b.vx,b.vy)<this.stopSpeed) b.vx=b.vy=0;
      }
      if(this.balls.every(b=>b.pocketed)) {
        this.cleared=true;this.clearAt=this.time+this.clearDelay;this.rounds++;
        events.push({type:'clear',round:this.round,roundScore:this.roundScore,score:this.score});
      }
    }
    this.previousCue=scratch?null:current;
    return events;
  }
}
module.exports = { PhysicsEngine, segmentCircle, MULTIPLIERS, MAX_DT, MAX_SUBSTEPS };
