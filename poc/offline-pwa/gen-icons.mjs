// Generates plain green PNG icons with a white "B" block pattern (no dependencies).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return(crc^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function png(size){
  const rows=[];
  for(let y=0;y<size;y++){
    const row=Buffer.alloc(1+size*3);
    for(let x=0;x<size;x++){
      const u=x/size,v=y/size;
      // white rounded "B"-like glyph from rectangles
      const stem=u>0.30&&u<0.40&&v>0.22&&v<0.78;
      const top=u>=0.40&&u<0.64&&((v>0.22&&v<0.30)||(v>0.46&&v<0.54)||(v>0.70&&v<0.78));
      const right=u>0.62&&u<0.70&&((v>0.28&&v<0.48)||(v>0.52&&v<0.72));
      const on=stem||top||right;
      const o=1+x*3; row[o]=on?255:0x1b; row[o+1]=on?255:0x5e; row[o+2]=on?255:0x20;
    }
    rows.push(row);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
for(const s of [180,192,512]) writeFileSync(new URL(`./public/${s===180?'apple-touch-icon':'icon-'+s}.png`,import.meta.url),png(s));
