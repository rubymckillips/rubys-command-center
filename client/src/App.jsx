import { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import ClassGroup from './components/ClassGroup.jsx';
import EntryForm from './components/EntryForm.jsx';
import EntryList from './components/EntryList.jsx';
import LoginForm from './components/LoginForm.jsx';
import Members from './components/Members.jsx';
import { buildItemPatch } from './lib/itemPatch.js';
import Sidebar, { sections } from './components/Sidebar.jsx';
import SyncStatus from './components/SyncStatus.jsx';

const sectionTitles = Object.fromEntries(sections.map((section) => [section.id, section.label]));

function CommandCenter({ onLogout, user }) {
  const [showMembers,setShowMembers]=useState(false);
  const [currentSection, setCurrentSection] = useState('academics');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [syncState, setSyncState] = useState({ status: 'idle', error: null });

  const loadItems = useCallback(async (section) => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = section === 'today' ? await api.listToday() : await api.listItems(section);
      setItems(result.items ?? []);
    } catch (error) {
      setItems([]);
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(currentSection); }, [currentSection, loadItems]);

  async function refreshAffectedList(action) {
    setMutationError(null);
    try {
      await action();
      await loadItems(currentSection);
    } catch (error) {
      setMutationError(error);
    }
  }

  async function handleSync(source) {
    setSyncState({ status: 'syncing', error: null });
    try {
      await api.sync(source);
      setSyncState({ status: 'success', error: null });
      await loadItems(currentSection);
    } catch (error) {
      setSyncState({ status: 'error', error });
    }
  }

  function handleEdit(item, patch) {
    if (patch) {
      refreshAffectedList(() => api.updateItem(item.id, patch));
      return;
    }
    setEditing({ initialItem: item, section: item?.section ?? (currentSection === 'today' ? 'academics' : currentSection) });
  }

  function handleSave(fields) {
    const initialItem = editing.initialItem;
    const sourceOwned = Boolean(initialItem?.source);
    const sourceSafeFields = sourceOwned ? {
      ...fields,
      title: initialItem.title,
      dueAt: initialItem.dueAt,
    } : fields;
    const localFields = {
      ...buildItemPatch(initialItem, sourceSafeFields),
      ...(fields.plannedFor !== undefined ? { plannedFor: fields.plannedFor } : {}),
      ...(fields.workoutType !== undefined ? { workoutType: fields.workoutType } : {}),
      ...(fields.mealType !== undefined ? { mealType: fields.mealType } : {}),
      ...(fields.prepNotes !== undefined ? { prepNotes: fields.prepNotes } : {}),
      ...(fields.checklist !== undefined ? { checklist: fields.checklist } : {}),
    };
    setEditing(null);
    refreshAffectedList(() => initialItem ? api.updateItem(initialItem.id, localFields) : api.createItem({
      ...fields,
      inToday: currentSection === 'today',
    }));
  }

  function handleReorder(scope, orderedIds) {
    const reorderedIds = new Set(orderedIds);
    let nextId = 0;
    const completeOrder = items.map((item) => (reorderedIds.has(item.id) ? orderedIds[nextId++] : item.id));
    refreshAffectedList(() => api.reorderItems(scope, completeOrder));
  }

  function renderList(listItems, scope = currentSection) {
    return <EntryList items={listItems} scope={scope} onEdit={handleEdit}
      onDelete={(item) => refreshAffectedList(() => api.deleteItem(item.id))}
      onToggleToday={(item, included) => refreshAffectedList(() => api.setToday(item.id, included))}
      onReorder={handleReorder} />;
  }

  function renderItems() {
    if (currentSection === 'calendar') {
      const dates = new Map();
      items.forEach((item) => {
        const date = item.dueAt ? new Date(item.dueAt) : null;
        const label = date && !Number.isNaN(date.valueOf())
          ? date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
          : 'No scheduled date';
        dates.set(label, [...(dates.get(label) ?? []), item]);
      });
      return <div className="calendar-groups">
        {[...dates.entries()].map(([date, dateItems]) => (
          <ClassGroup className={date} key={date}>{renderList(dateItems, 'calendar')}</ClassGroup>
        ))}
        {items.length === 0 && renderList(items, 'calendar')}
      </div>;
    }
    if (currentSection !== 'academics') return renderList(items);
    const classGroups = new Map();
    const otherItems = [];
    items.forEach((item) => {
      if (item.source === 'canvas' && item.className) {
        classGroups.set(item.className, [...(classGroups.get(item.className) ?? []), item]);
      } else {
        otherItems.push(item);
      }
    });
    return <div className="class-groups">
      {[...classGroups.entries()].map(([className, groupItems]) => (
        <ClassGroup className={className} key={className}>{renderList(groupItems, 'academics')}</ClassGroup>
      ))}
      {otherItems.length > 0 && <ClassGroup className="Other academics">{renderList(otherItems, 'academics')}</ClassGroup>}
      {items.length === 0 && renderList(items, 'academics')}
    </div>;
  }

  const title = sectionTitles[currentSection];
  return (
    <main className="app-shell">
      <Sidebar currentSection={currentSection} onSelect={setCurrentSection} />
      <section className="content" aria-labelledby="page-title">
        <header className="content-header">
          <div>
            <p className="eyebrow">Unified Command Center</p>
            <h2 id="page-title">{title}</h2>
            <p className="section-summary">{currentSection === 'today' ? 'Your focused list for today.' : currentSection === 'calendar' ? 'Calendar entries, grouped by date, with your local notes.' : `Everything in ${title}.`}</p>
          </div>
          <div className="header-actions">
            <span>{user.login} · {user.role}</span>
            {user.role==='owner'&&<button type="button" onClick={()=>setShowMembers(!showMembers)}>{showMembers?'Close members':'Members'}</button>}
            <button type="button" className="logout-button" onClick={onLogout}>Log out</button>
            <SyncStatus status={syncState.status} error={syncState.error} onSync={handleSync} disabled={import.meta.env.PROD} />
          </div>
        </header>
        {showMembers&&user.role==='owner'&&<Members/>}
        {loadError && <div className="notice notice-error" role="alert">Could not load {title}: {loadError.message}</div>}
        {mutationError && <div className="notice notice-error" role="alert">Could not save this change: {mutationError.message}</div>}
        <div className="items-panel" aria-live="polite">
          {loading && <p className="empty-state">Loading {title.toLowerCase()}…</p>}
          {!loading && !loadError && renderItems()}
        </div>
        {editing && <div className="form-backdrop" role="presentation">
          <section className="entry-editor" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
            <h3 id="entry-editor-title">{editing.initialItem ? 'Edit entry' : 'Add entry'}</h3>
            <EntryForm initialItem={editing.initialItem} section={editing.section} onSave={handleSave} onCancel={() => setEditing(null)} />
          </section>
        </div>}
      </section>
    </main>
  );
}

export default function App() {
  const [user,setUser]=useState(null),[pending,setPending]=useState(true),[loginError,setLoginError]=useState('');
  useEffect(()=>{
    let active=true;
    const clear=api.setUnauthorizedHandler(()=>{if(active)setUser(null);});
    const failed=new URLSearchParams(window.location.search).get('signin')==='failed';
    if(failed){setLoginError('GitHub sign-in could not be completed. Please try again.');window.history.replaceState({},'',window.location.pathname);}
    api.session().then(result=>{if(active)setUser(result.user);}).catch(error=>{if(active&&error.code!=='unauthorized')setLoginError(error.message);}).finally(()=>{if(active)setPending(false);});
    return()=>{active=false;clear();};
  },[]);
  async function signOut(){
    try{await api.logout();setUser(null);setLoginError('');}catch(error){setLoginError(error.message);}
  }
  if(!user)return <LoginForm pending={pending} error={loginError}/>;
  return <>{loginError&&<p className="notice notice-error" role="alert">{loginError}</p>}<CommandCenter onLogout={signOut} user={user}/></>;
}
