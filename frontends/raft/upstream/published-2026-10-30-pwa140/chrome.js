var Jpe={frame:{light:`#FFD440`,dark:`#0D0D0B`},paper:{light:`#FFFFFF`,dark:`#1B1B19`}},Ype={frame:`var(--layer-frame)`,paper:`var(--layer-canvas)`},Xpe=`frame`;
function Zpe(e,t){return Jpe[e][t]}
function Qpe(e,t,n){return`#${[e,t,n].map(e=>e.toString(16).padStart(2,`0`)).join(``)}`}
var q_;
function $pe(){if(q_!==void 0)return q_;try{let e=document.createElement(`canvas`);e.width=1,e.height=1,q_=e.getContext(`2d`,{willReadFrequently:!0})}catch{q_=null}return q_}
function eme(e){let t=/^var\((--[\w-]+)\)$/.exec(e)?.[1];if(!t||!getComputedStyle(document.documentElement).getPropertyValue(t).trim())return null;let n=$pe();if(!n)return null;let r=document.createElement(`span`);r.style.color=e,r.style.display=`none`,document.documentElement.appendChild(r);let i=getComputedStyle(r).color;if(r.remove(),n.fillStyle=`#010203`,n.fillStyle=i,n.fillStyle===`#010203`)return null;n.clearRect(0,0,1,1),n.fillRect(0,0,1,1);let[a,o,s]=n.getImageData(0,0,1,1).data;return Qpe(a,o,s)}
var tme=eme,nme=new Map;
function rme(e,t){let n=document.documentElement.dataset.theme;if(n){let r=`${n}|${t}|${e}`,i=nme.get(r)??null;if(i||(i=tme(Ype[e]),i&&nme.set(r,i)),i)return i}return Zpe(e,t)}
export {rme as resolveBrowserChromeColor};
