import sharp from 'sharp';
// discriminating premultiply test: left half opaque RED, right half transparent WHITE
const w=8,h=1; const buf=Buffer.alloc(w*h*4,0);
for(let x=0;x<w;x++){ if(x<4){buf[x*4]=255;buf[x*4+3]=255;} else {buf[x*4]=255;buf[x*4+1]=255;buf[x*4+2]=255;buf[x*4+3]=0;} }
const show=(b)=>Array.from({length:w},(_,x)=>[...b.slice(x*4,x*4+4)].join('/')).join(' ');
console.log('blur   :', show(await sharp(buf,{raw:{width:w,height:h,channels:4}}).blur(1.5).raw().toBuffer()));
const N=5; const k=new Array(3*N).fill(0); for(let i=0;i<N;i++) k[N+i]=1;
console.log('convolv:', show(await sharp(buf,{raw:{width:w,height:h,channels:4}}).convolve({width:N,height:3,kernel:k,scale:N}).raw().toBuffer()));
console.log('resize :', show(await sharp(buf,{raw:{width:w,height:h,channels:4}}).resize(w,h,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer()));
// perf: composite two 3840x2160 raw buffers
const W=3840,H=2160;
const big = Buffer.alloc(W*H*4, 60);
let t=Date.now();
const r = await sharp(big,{raw:{width:W,height:H,channels:4}}).composite([{input:big,raw:{width:W,height:H,channels:4},top:0,left:0,blend:'screen'}]).raw().toBuffer();
console.log('4K composite ms', Date.now()-t, r.length);
t=Date.now();
await sharp(big,{raw:{width:W,height:H,channels:4}}).resize(1920,1080,{kernel:'lanczos3'}).raw().toBuffer();
console.log('4K->1080 lanczos ms', Date.now()-t);
t=Date.now();
await sharp(big,{raw:{width:W,height:H,channels:4}}).blur(20).raw().toBuffer();
console.log('4K blur20 ms', Date.now()-t);
