// GENERATED from the unchanged Web1.21.38 clipboard declaration.
async function DL(e,t){if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(e);return}let n=document.createElement(`textarea`);n.value=e,n.style.position=`fixed`,n.style.left=`-9999px`,document.body.appendChild(n),n.focus(),n.select();try{if(!document.execCommand(`copy`))throw Error(t?t({id:`message.share.clipboardRejected`}):`The browser rejected the clipboard copy command`)}finally{n.remove()}}
export {DL as copyText};
