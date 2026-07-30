const fs=require('fs');
const p=(f,pairs)=>{let c=fs.readFileSync(f,'utf8'),n=0;for(const[a,b]of pairs)if(c.includes(a)){c=c.replace(a,b);n++;}if(n){fs.writeFileSync(f,c);console.log(f+': '+n)}else console.log(f+': skip')};
