import sharp from 'sharp';
// 1-channel raw blur: what comes back?
const w=16,h=8; const m=Buffer.alloc(w*h,0);
for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x>=4&&x<12) m[y*w+x]=255;
const r = await sharp(m,{raw:{width:w,height:h,channels:1}}).blur(2).raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
console.log('1ch blur ->', r.info.width, r.info.height, r.info.channels, 'len', r.data.length);
console.log('row0:', [...r.data.slice(0,16)].join(','));
// without depth
const r2 = await sharp(m,{raw:{width:w,height:h,channels:1}}).blur(2).raw().toBuffer({resolveWithObject:true});
console.log('no-depth ->', r2.info.channels, r2.data.length);
// extend on 1ch
const e = await sharp(m,{raw:{width:w,height:h,channels:1}}).extend({top:1,bottom:1,left:1,right:1,background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer({resolveWithObject:true});
console.log('1ch extend ->', e.info.width,e.info.height,e.info.channels);
// double rotate in one pipeline?
const img = await sharp({create:{width:20,height:10,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).raw().toBuffer();
const d = await sharp(img,{raw:{width:20,height:10,channels:4}}).rotate(30,{background:{r:0,g:0,b:0,alpha:0}}).rotate(-30,{background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer({resolveWithObject:true});
console.log('double rotate ->', d.info.width, d.info.height, '(expect ~26x24 if both applied, 20x10 if cancelled/last-wins ~22x19)');
