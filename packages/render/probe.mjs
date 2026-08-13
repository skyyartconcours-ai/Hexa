import sharp from 'sharp';
const w=16,h=8; const m=Buffer.alloc(w*h,0);
for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x>=4&&x<12) m[y*w+x]=255;
for (const tag of ['bw','none']) {
  let p = sharp(m,{raw:{width:w,height:h,channels:1}}).blur(2);
  if (tag==='bw') p = p.toColourspace('b-w');
  const r = await p.raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  console.log(tag, '->', r.info.channels, r.data.length, [...r.data.slice(0,8)].join(','));
}
// resize 1ch with b-w
const r = await sharp(m,{raw:{width:w,height:h,channels:1}}).resize(32,16,{kernel:'cubic',fit:'fill'}).toColourspace('b-w').raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
console.log('resize bw ->', r.info.channels, r.data.length, 32*16);
// extend 1ch with b-w
const e = await sharp(m,{raw:{width:w,height:h,channels:1}}).extend({top:1,bottom:1,left:1,right:1,background:{r:0,g:0,b:0,alpha:0}}).toColourspace('b-w').raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
console.log('extend bw ->', e.info.channels, e.data.length, 18*10);
