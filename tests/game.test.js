const T = require(require('path').join(__dirname, '..', 'game.js'));
const assert = require('assert');
assert.equal(T.windows(3).length, 8); assert.equal(T.windows(5).length, 28); assert.equal(T.windows(7).length, 60);

// 3x3 hard AI is unbeatable: explore every possible X reply
for (const r of [0, 0.5, 0.999]) {
  let games = 0;
  (function explore(b, turn) {
    const w = T.findWinner(b, 3);
    if (w) { assert.notEqual(w.mark, 'X', 'X beat the AI'); games++; return; }
    const e = T.emptyCells(b); if (!e.length) { games++; return; }
    if (turn === 'X') for (const i of e) { b[i]='X'; explore(b,'O'); b[i]=null; }
    else { const m = T.chooseMove('hard', b, 3, () => r); b[m]='O'; explore(b,'X'); b[m]=null; }
  })(Array(9).fill(null), 'X');
  console.log('3x3 exhaustive ok, leaves:', games);
}
// AI takes a win / blocks on 5x5 (4 in a row)
let b = Array(25).fill(null); b[0]=b[1]=b[2]='O'; b[10]=b[11]='X';
assert.equal(T.chooseMove('hard', b, 5), 3);
b = Array(25).fill(null); b[5]=b[6]=b[7]='X'; b[20]='O';
assert.ok([4,8].includes(T.chooseMove('hard', b, 5)));
// 7x7 completes and rarely loses vs random X
for (const size of [5,7]) {
  let lost=0, drew=0, won=0, N=300;
  for (let g=0; g<N; g++) {
    const bd = Array(size*size).fill(null); let turn='X';
    while (true) {
      const w = T.findWinner(bd,size); if (w){ w.mark==='X'?lost++:won++; break; }
      const e = T.emptyCells(bd); if(!e.length){drew++;break;}
      const m = turn==='X' ? e[Math.floor(Math.random()*e.length)] : T.chooseMove('hard',bd,size);
      bd[m]=turn; turn = turn==='X'?'O':'X';
    }
  }
  console.log(size+'x'+size, 'hard AI vs random: won',won,'drew',drew,'lost',lost);
}
// percentages sum to 100
for (let i=0;i<500;i++){ const c={W:Math.floor(Math.random()*21),L:Math.floor(Math.random()*21),D:Math.floor(Math.random()*21)}; const p=T.percentages(c); const t=c.W+c.L+c.D; assert.equal(p.W+p.L+p.D, t?100:0); }
console.log('percentages ok');
