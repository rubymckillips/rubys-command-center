import {useEffect,useState} from 'react';
import {listMembers,setSuspended} from '../api.js';
export default function Members(){
  const [members,setMembers]=useState([]),[error,setError]=useState(''),[pending,setPending]=useState(false);
  useEffect(()=>{let active=true;listMembers().then(result=>{if(active)setMembers(result.members);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function toggle(member){
    setPending(true);setError('');
    try{await setSuspended(member.id,!member.suspended);setMembers((await listMembers()).members);}catch(e){setError(e.message);}finally{setPending(false);}
  }
  return <section className="items-panel" aria-label="App members">
    <h3>Members</h3><p>Members have separate private workspaces. Suspending access signs them out.</p>
    {error&&<p role="alert">{error}</p>}
    <ul>{members.map(member=><li key={member.id}>
      {member.login} · {member.role} {member.suspended?'· Suspended':''}{' '}
      {member.role!=='owner'&&<button disabled={pending} onClick={()=>toggle(member)}>{member.suspended?'Restore access':'Suspend access'}</button>}
    </li>)}</ul>
  </section>;
}
