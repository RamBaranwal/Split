import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  AlertTriangle, 
  CheckCircle2, 
  FileUp, 
  LogIn, 
  Plus, 
  ReceiptText, 
  RefreshCw, 
  UsersRound, 
  WalletCards, 
  LayoutDashboard, 
  Coins, 
  Layers, 
  BookOpen, 
  UserCheck, 
  Info,
  ArrowRight,
  Sparkles,
  Trash2
} from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000';

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('split-session') || 'null'));
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  
  // Custom Tab System State
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Custom Recruiter Features State
  const [displayCurrency, setDisplayCurrency] = useState('INR');
  const [highlightedRows, setHighlightedRows] = useState([]);
  const [dryRun, setDryRun] = useState(false);
  
  // Add Member state
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newAliasValue, setNewAliasValue] = useState({});

  // Advanced manual splitting states
  const [manualSplitType, setManualSplitType] = useState('equal');
  const [selectedSplitMembers, setSelectedSplitMembers] = useState([]);
  const [manualSplitValues, setManualSplitValues] = useState({});

  // Selected Expense details drawer state
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');

  // Auto-select members for splitting by default when group loads
  useEffect(() => {
    setSelectedSplitMembers(members.map(m => m.name));
    setManualSplitValues({});
  }, [members]);

  // Handle invitation link query param on startup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('invite');
    if (inviteId) {
      setGroupId(inviteId);
      window.history.replaceState({}, document.title, window.location.pathname);
      showNotice('Joined group via invite link!');
    }
  }, []);

  // Poll comments for real-time chat updates
  useEffect(() => {
    if (!selectedExpense) return;
    loadComments(selectedExpense.id);
    
    const interval = setInterval(() => {
      loadComments(selectedExpense.id);
    }, 4000);
    
    return () => clearInterval(interval);
  }, [selectedExpense]);

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    if (groupId) refreshGroup(groupId);
  }, [groupId]);

  async function loadGroups() {
    try {
      const data = await api('/api/groups');
      setGroups(data.groups);
      if (data.groups[0] && !groupId) {
        setGroupId(String(data.groups[0].id || data.groups[0]._id));
      }
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  async function handleCreateGroup() {
    const name = prompt('Enter the name for the new group:');
    if (!name || !name.trim()) return;
    try {
      setBusy(true);
      const data = await api('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      await loadGroups();
      setGroupId(String(data.group.id || data.group._id));
      showNotice(`Successfully created group "${data.group.name}"!`);
      setActiveTab('members');
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteGroup() {
    const currentGroup = groups.find(g => String(g.id) === String(groupId));
    if (!currentGroup) return;
    if (!confirm(`Are you sure you want to delete the group "${currentGroup.name}" and all of its members, expenses, and settlements? This action cannot be undone.`)) {
      return;
    }
    try {
      setBusy(true);
      await api(`/api/groups/${groupId}`, { method: 'DELETE' });
      showNotice(`Successfully deleted group "${currentGroup.name}".`);
      const updatedGroups = groups.filter(g => String(g.id) !== String(groupId));
      setGroups(updatedGroups);
      if (updatedGroups.length > 0) {
        setGroupId(String(updatedGroups[0].id));
      } else {
        await loadGroups();
      }
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refreshGroup(id = groupId) {
    if (!id) return;
    try {
      const [memberData, expenseData, balanceData, importData] = await Promise.all([
        api(`/api/groups/${id}/members`),
        api(`/api/groups/${id}/expenses`),
        api(`/api/groups/${id}/balances`),
        api(`/api/groups/${id}/imports/latest`)
      ]);
      setMembers(memberData.members);
      setExpenses(expenseData.expenses);
      setBalances(balanceData.balances);
      setReport(importData.report);
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  function showNotice(text, type = 'success') {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 6000);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password'), name: form.get('name') || 'Demo User' })
      });
      localStorage.setItem('split-session', JSON.stringify(data));
      setSession(data);
      showNotice('Logged in successfully!');
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  function handleLogout() {
    localStorage.removeItem('split-session');
    setSession(null);
  }

  async function handleImport(event) {
    event.preventDefault();
    const file = event.currentTarget.file.files[0];
    if (!file) return showNotice('Choose expenses_export.csv first.', 'error');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api(`/api/groups/${groupId}/imports?dryRun=${dryRun}`, { method: 'POST', body: form });
      
      setReport({ 
        run: { 
          id: data.importRunId, 
          summary: data.report.summary, 
          created_at: data.createdAt 
        }, 
        anomalies: data.report.anomalies 
      });
      
      if (!dryRun) {
        await refreshGroup(groupId);
        showNotice(`Imported ${data.report.summary.totalRows} rows with ${data.report.summary.anomalyCount} anomalies stored in MongoDB.`);
      } else {
        showNotice(`DRY RUN: Evaluated ${data.report.summary.totalRows} rows. Surfaced ${data.report.summary.anomalyCount} warnings. No database changes saved.`, 'warning');
      }
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: form.get('name'), 
          joinDate: form.get('joinDate'), 
          leaveDate: form.get('leaveDate') || null 
        })
      });
      formEl.reset();
      setIsAddingMember(false);
      await refreshGroup(groupId);
      showNotice('Added new member successfully!');
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  async function handleRemoveMember(memberId, name) {
    if (!confirm(`Are you sure you want to remove ${name} from this group?`)) return;
    try {
      setBusy(true);
      await api(`/api/members/${memberId}`, { method: 'DELETE' });
      await refreshGroup(groupId);
      showNotice(`Successfully removed member "${name}".`);
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleInviteMember() {
    const inviteUrl = `${window.location.origin}/?invite=${groupId}`;
    navigator.clipboard.writeText(inviteUrl);
    alert(`Invite link for this group copied to clipboard:\n\n${inviteUrl}\n\nSend this link to invite users to this group!`);
  }

  async function loadComments(expenseId) {
    try {
      const data = await api(`/api/expenses/${expenseId}/comments`);
      setComments(data.comments);
    } catch (e) {
      console.error('Failed to load comments:', e);
    }
  }

  async function handlePostComment(event) {
    event.preventDefault();
    if (!newComment.trim()) return;
    try {
      const data = await api(`/api/expenses/${selectedExpense.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: session.user.name,
          message: newComment.trim()
        })
      });
      setNewComment('');
      setComments(prev => [...prev, data.comment]);
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  const handleSplitValueChange = (memberName, val) => {
    setManualSplitValues(prev => ({ ...prev, [memberName]: val }));
  };

  async function handleAddAlias(memberId, currentAliases) {
    const rawVal = newAliasValue[memberId] || '';
    const clean = rawVal.trim();
    if (!clean) return;
    
    const updatedAliases = [...currentAliases, clean];
    try {
      await api(`/api/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: updatedAliases })
      });
      setNewAliasValue(prev => ({ ...prev, [memberId]: '' }));
      await refreshGroup(groupId);
      showNotice('Alias added successfully!');
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  async function handleSettleDebt(from, to, amountInr) {
    try {
      setBusy(true);
      const today = new Date().toISOString().split('T')[0];
      await api(`/api/groups/${groupId}/settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settlementDate: today,
          payer: from,
          payee: to,
          amountInr: amountInr,
          description: `Settled via flowchart on dashboard`
        })
      });
      await refreshGroup(groupId);
      showNotice(`Recorded settlement: ${from} paid ${formatCurrency(amountInr, displayCurrency)} to ${to}. Saved to MongoDB.`);
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddManualExpense(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const date = form.get('expenseDate');
    const desc = form.get('description');
    const payer = form.get('paidBy');
    const amount = Number(form.get('amountInr'));
    
    if (!selectedSplitMembers.length) {
      return showNotice('Select at least one participant to split with.', 'error');
    }
    
    let splits = [];
    if (manualSplitType === 'equal') {
      const shareAmount = Math.round((amount / selectedSplitMembers.length) * 100) / 100;
      splits = selectedSplitMembers.map(name => ({
        member: name,
        amountInr: shareAmount
      }));
    } else if (manualSplitType === 'unequal') {
      let totalAssigned = 0;
      splits = selectedSplitMembers.map(name => {
        const val = Number(manualSplitValues[name] || 0);
        totalAssigned += val;
        return { member: name, amountInr: val };
      });
      if (Math.abs(totalAssigned - amount) > 0.01) {
        return showNotice(`Total assigned split amounts (₹${totalAssigned}) must sum to the expense total (₹${amount}). Mismatch of ₹${Math.round((amount - totalAssigned)*100)/100}.`, 'error');
      }
    } else if (manualSplitType === 'percentage') {
      let totalPercent = 0;
      splits = selectedSplitMembers.map(name => {
        const pct = Number(manualSplitValues[name] || 0);
        totalPercent += pct;
        const shareAmount = Math.round((amount * (pct / 100)) * 100) / 100;
        return { member: name, amountInr: shareAmount };
      });
      if (Math.abs(totalPercent - 100) > 0.01) {
        return showNotice(`Percentages must sum to 100%. Currently they sum to ${totalPercent}%.`, 'error');
      }
    } else if (manualSplitType === 'share') {
      let totalShares = 0;
      const sharesList = selectedSplitMembers.map(name => {
        const sh = Number(manualSplitValues[name] || 1);
        totalShares += sh;
        return { member: name, share: sh };
      });
      if (totalShares <= 0) {
        return showNotice('Total split shares ratio must be greater than zero.', 'error');
      }
      splits = sharesList.map(item => {
        const shareAmount = Math.round((amount * (item.share / totalShares)) * 100) / 100;
        return { member: item.member, amountInr: shareAmount };
      });
    }

    try {
      await api(`/api/groups/${groupId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseDate: date,
          description: desc,
          paidBy: payer,
          amountInr: amount,
          splitType: manualSplitType,
          splits,
          notes: form.get('notes') || ''
        })
      });
      formEl.reset();
      setManualSplitValues({});
      await refreshGroup(groupId);
      showNotice('Added manual expense successfully!');
    } catch (e) {
      showNotice(e.message, 'error');
    }
  }

  async function handleApproveExpense(expenseId) {
    try {
      setBusy(true);
      await api(`/api/expenses/${expenseId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      });
      await refreshGroup(groupId);
      showNotice('Expense approved and added to balances calculation.');
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectExpense(expenseId) {
    try {
      setBusy(true);
      await api(`/api/expenses/${expenseId}`, {
        method: 'DELETE'
      });
      await refreshGroup(groupId);
      showNotice('Expense dismissed and deleted from database.');
    } catch (e) {
      showNotice(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function formatCurrency(valInr, targetCurrency = displayCurrency) {
    const value = Number(valInr || 0);
    if (targetCurrency === 'USD') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 83);
    } else if (targetCurrency === 'EUR') {
      return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 90);
    }
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
  }

  const acceptedCount = expenses.filter((expense) => expense.status === 'accepted').length;
  const reviewCount = expenses.filter((expense) => expense.status === 'needs_review').length;
  const totalInr = expenses.filter((expense) => expense.status === 'accepted').reduce((sum, expense) => sum + Number(expense.amount_inr), 0);

  if (!session) {
    return (
      <main className="login-screen">
        <section className="panel login-card">
          <h2>Demo Sign In</h2>
          <p>Register or log in with any email and password credentials to instantiate a session connected to MongoDB.</p>
          <form onSubmit={handleLogin}>
            <label>Name<input name="name" defaultValue="Evaluator" placeholder="Name" /></label>
            <label>Email<input name="email" type="email" defaultValue="evaluator@split.test" placeholder="email@address.com" required /></label>
            <label>Password<input name="password" type="password" defaultValue="password123" placeholder="••••••••" required /></label>
            <button className="btn" type="submit"><LogIn size={18} /> Sign in</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-container">
      {/* Premium Sidebar Navigation */}
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="eyebrow">Split Expenses</span>
            <h1>MERN Dashboard</h1>
          </div>
          
          <nav className="nav-links">
            <button 
              className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard size={18} />
              Dashboard
            </button>
            <button 
              className={`nav-item ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              <ReceiptText size={18} />
              Expense Ledger
            </button>
            <button 
              className={`nav-item ${activeTab === 'members' ? 'active' : ''}`}
              onClick={() => setActiveTab('members')}
            >
              <UsersRound size={18} />
              Members & Aliases
            </button>
            <button 
              className={`nav-item ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              <AlertTriangle size={18} />
              Review Queue
              {reviewCount > 0 && (
                <span className="badge needs_review" style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: '0.65rem', borderRadius: '4px' }}>
                  {reviewCount}
                </span>
              )}
            </button>
            <button 
              className={`nav-item ${activeTab === 'importer' ? 'active' : ''}`}
              onClick={() => setActiveTab('importer')}
            >
              <FileUp size={18} />
              CSV Import Center
            </button>
            <button 
              className={`nav-item ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setActiveTab('guide')}
            >
              <BookOpen size={18} />
              Assets & Guide
            </button>
          </nav>
        </div>

        <div className="user-profile">
          <div className="user-avatar">{session.user.name.charAt(0)}</div>
          <div className="user-info">
            <span>{session.user.name}</span>
            <small onClick={handleLogout} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Sign Out</small>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-window">
        {/* Top Controls Bar */}
        <header className="header-row">
          <div>
            <h2>
              {activeTab === 'dashboard' && 'Dashboard Overview'}
              {activeTab === 'expenses' && 'Expense Ledger'}
              {activeTab === 'members' && 'Group Membership'}
              {activeTab === 'review' && 'Review Queue'}
              {activeTab === 'importer' && 'CSV Importer'}
              {activeTab === 'guide' && 'Technical Guide & Asset Inspector'}
            </h2>
          </div>

          <div className="options-bar">
            {/* Group Selector */}
            <label>
              Group
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)} style={{ minWidth: '150px' }}>
                  {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
                </select>
                <button 
                  className="btn" 
                  style={{ height: '42px', padding: '0 12px', minWidth: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={handleCreateGroup}
                  title="Create a New Group"
                  type="button"
                >
                  <Plus size={18} />
                </button>
                <button 
                  className="btn" 
                  style={{ height: '42px', padding: '0 12px', minWidth: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-danger, #ef4444)', border: 'none', color: '#fff' }}
                  onClick={handleDeleteGroup}
                  title="Delete Current Group"
                  type="button"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </label>

            {/* Currency Selector (Unique Recruiter Feature) */}
            <label>
              Currency
              <select value={displayCurrency} onChange={(event) => setDisplayCurrency(event.target.value)}>
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </label>
          </div>
        </header>

        {/* Global Notifications */}
        {message ? (
          <div className={`alert-banner ${messageType === 'error' ? 'error' : ''}`}>
            {messageType === 'error' ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            <span>{message}</span>
          </div>
        ) : null}

        {/* Tab content renderer */}
        {activeTab === 'dashboard' && (
          <div className="tab-pane">
            {/* Metric Grid */}
            <section className="metrics-grid">
              <div className="metric-card success-card">
                <div className="metric-icon-wrap"><WalletCards size={20} /></div>
                <div className="metric-data">
                  <span>Accepted total</span>
                  <strong>{formatCurrency(totalInr)}</strong>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon-wrap"><ReceiptText size={20} /></div>
                <div className="metric-data">
                  <span>Accepted expenses</span>
                  <strong>{acceptedCount}</strong>
                </div>
              </div>
              <div className="metric-card needs-review-card">
                <div className="metric-icon-wrap"><AlertTriangle size={20} /></div>
                <div className="metric-data">
                  <span>Needs review</span>
                  <strong>{reviewCount}</strong>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon-wrap"><UsersRound size={20} /></div>
                <div className="metric-data">
                  <span>Members tracked</span>
                  <strong>{members.length}</strong>
                </div>
              </div>
            </section>

            {/* Dashboard grid (Balances + Visual flowchart) */}
            <div className="dashboard-grid">
              <section className="panel">
                <h2><Coins size={18} /> Individual Balance Summary</h2>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Paid</th>
                        <th>Owed Share</th>
                        <th>Net Balance</th>
                        <th>Ledger Trace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map((row) => (
                        <tr 
                          key={row.member}
                          onMouseEnter={() => setHighlightedRows(row.expenseRows || [])}
                          onMouseLeave={() => setHighlightedRows([])}
                          style={{ cursor: 'pointer' }}
                          title="Hover to highlight this member's transactions in the ledger"
                        >
                          <td style={{ fontWeight: 700 }}>{row.member}</td>
                          <td>{formatCurrency(row.paid)}</td>
                          <td>{formatCurrency(row.owed)}</td>
                          <td className={row.net >= 0 ? 'positive' : 'negative'}>
                            {row.net >= 0 ? '+' : ''}{formatCurrency(row.net)}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>
                            {row.expenseRows?.length ? `${row.expenseRows.length} rows` : '-'}
                          </td>
                        </tr>
                      ))}
                      {!balances.length && (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No active balances. Please upload expenses first.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <small style={{ display: 'block', marginTop: '12px', color: 'var(--text-muted)' }}>
                  💡 <span style={{ color: 'var(--color-primary)' }}>Interactive Tooltip:</span> Hovering over any member row automatically highlights the CSV ledger rows they participated in (active in the Expense Ledger tab).
                </small>
              </section>

              <section className="panel">
                <h2><Sparkles size={18} /> Interactive Debt Settlement Flowchart</h2>
                <div className="settlement-flowchart">
                  {(() => {
                    const allDebts = simplifyDebtsList(balances);
                    // Only show debts where the current logged-in user is the payer (they owe money)
                    const myDebts = allDebts.filter(
                      item => item.from.toLowerCase() === session?.user?.name?.toLowerCase()
                    );
                    if (!myDebts.length) {
                      return (
                        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                          {allDebts.length > 0
                            ? `✅ You have no pending debts to settle! Others may still owe each other.`
                            : `All shared expenses are fully settled! No pending transfers.`
                          }
                        </p>
                      );
                    }
                    return myDebts.map((item) => (
                      <div className="settlement-card" key={`${item.from}-${item.to}-${item.amountInr}`}>
                        <div className="node-person debtor">
                          <div className="node-avatar">{item.from.charAt(0)}</div>
                          <span className="node-name">{item.from}</span>
                        </div>
                        
                        <div className="flow-connector">
                          <div className="flow-line-wrap">
                            <div className="flow-line">
                              <div className="flow-arrow"></div>
                            </div>
                          </div>
                          <span className="flow-amount">{formatCurrency(item.amountInr)}</span>
                        </div>

                        <div className="node-person creditor">
                          <div className="node-avatar">{item.to.charAt(0)}</div>
                          <span className="node-name">{item.to}</span>
                        </div>

                        <button 
                          className="btn-settle"
                          disabled={busy}
                          onClick={() => handleSettleDebt(item.from, item.to, item.amountInr)}
                        >
                          Settle
                        </button>
                      </div>
                    ));
                  })()}
                </div>
                {/* Show a summary of what others owe you */}
                {(() => {
                  const allDebts = simplifyDebtsList(balances);
                  const othersOweMe = allDebts.filter(
                    item => item.to.toLowerCase() === session?.user?.name?.toLowerCase()
                  );
                  if (!othersOweMe.length) return null;
                  return (
                    <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 600 }}>💰 People who owe you:</h4>
                      {othersOweMe.map(item => (
                        <div key={`owed-${item.from}-${item.to}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(16,185,129,0.07)', borderRadius: '8px', marginBottom: '6px', border: '1px solid rgba(16,185,129,0.15)' }}>
                          <span style={{ fontWeight: 600 }}>{item.from}</span>
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>owes you {formatCurrency(item.amountInr)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>
            </div>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="tab-pane">
            <div className="dashboard-grid">
              {/* Expense Ledger */}
              <section className="panel">
                <h2><ReceiptText size={18} /> Expense Ledger</h2>
                <div className="table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Paid By</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((expense) => {
                        const isHighlighted = highlightedRows.includes(expense.source_row);
                        return (
                          <tr 
                            key={expense.id}
                            className={isHighlighted ? 'highlighted-row' : ''}
                            onClick={() => setSelectedExpense(expense)}
                            style={{ cursor: 'pointer' }}
                            title="Click to view details, splits, and chat comments"
                          >
                            <td>{expense.source_row || '-'}</td>
                            <td>{expense.expense_date || '-'}</td>
                            <td style={{ fontWeight: 600 }}>{expense.description}</td>
                            <td>{expense.paid_by}</td>
                            <td>{formatCurrency(expense.amount_inr)}</td>
                            <td>
                              <span className={`badge ${expense.status}`}>
                                {expense.status}
                              </span>
                              {expense.commentCount > 0 && (
                                <span className="badge accepted" style={{ marginLeft: '6px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: 'var(--color-primary)', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                                  💬 {expense.commentCount}
                                </span>
                              )}
                              {expense.status === 'needs_review' && expense.excluded_reason && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-warning)', marginTop: '4px', maxWidth: '240px', lineHeight: '1.3' }}>
                                  ⚠️ {expense.excluded_reason}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!expenses.length && (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No expenses in the database.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Add Expense form */}
              <section className="panel">
                <h2><Plus size={18} /> Add Manual Expense</h2>
                <form onSubmit={handleAddManualExpense} className="compact-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <label>
                    Date
                    <input name="expenseDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
                  </label>
                  <label>
                    Description
                    <input name="description" placeholder="e.g. Electricity bill" required />
                  </label>
                  <label>
                    Paid By
                    <select name="paidBy" defaultValue={members.find(m => m.name.toLowerCase() === session?.user?.name?.toLowerCase())?.name || (members[0]?.name || '')}>
                      {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Amount (INR)
                    <input name="amountInr" type="number" step="0.01" min="0.01" placeholder="₹0.00" required />
                  </label>

                  <label>
                    Split Type
                    <select name="splitType" value={manualSplitType} onChange={(e) => setManualSplitType(e.target.value)}>
                      <option value="equal">Split Equally</option>
                      <option value="unequal">Split Unequally (Exact Amounts)</option>
                      <option value="percentage">Split by Percentage (%)</option>
                      <option value="share">Split by Share (Ratio)</option>
                    </select>
                  </label>
                  
                  <label style={{ display: 'block' }}>
                    Split Share Details
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', maxHeight: '160px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px' }}>
                      {members.map(m => {
                        const isChecked = selectedSplitMembers.includes(m.name);
                        return (
                          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px', marginBottom: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input 
                                type="checkbox" 
                                id={`chk-${m.name}`} 
                                checked={isChecked} 
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedSplitMembers(prev => [...prev, m.name]);
                                  } else {
                                    setSelectedSplitMembers(prev => prev.filter(name => name !== m.name));
                                  }
                                }}
                              />
                              <label htmlFor={`chk-${m.name}`} style={{ cursor: 'pointer', margin: 0 }}>{m.name}</label>
                            </div>
                            {isChecked && manualSplitType !== 'equal' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '26px', marginTop: '4px' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {manualSplitType === 'unequal' && 'Amount (₹):'}
                                  {manualSplitType === 'percentage' && 'Percentage (%):'}
                                  {manualSplitType === 'share' && 'Shares (ratio):'}
                                </span>
                                <input 
                                  type="number"
                                  step="any"
                                  style={{ height: '30px', width: '100px', fontSize: '0.85rem' }}
                                  placeholder={manualSplitType === 'unequal' ? '0.00' : (manualSplitType === 'percentage' ? '0' : '1')}
                                  value={manualSplitValues[m.name] || ''}
                                  onChange={(e) => handleSplitValueChange(m.name, e.target.value)}
                                  required
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </label>

                  <label>
                    Notes
                    <input name="notes" placeholder="Optional notes" />
                  </label>

                  <button className="btn btn-success" type="submit">
                    <Plus size={18} /> Add Expense
                  </button>
                </form>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="tab-pane">
            <section className="panel" style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2><UsersRound size={18} /> Active Members & Aliases</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-secondary" onClick={handleInviteMember} style={{ display: 'flex', gap: '6px', alignItems: 'center' }} type="button">
                    <Info size={16} /> Invite Member
                  </button>
                  <button className="btn" onClick={() => setIsAddingMember(!isAddingMember)}>
                    <Plus size={18} /> {isAddingMember ? 'Cancel' : 'Add Member'}
                  </button>
                </div>
              </div>

              {isAddingMember && (
                <form onSubmit={handleAddMember} style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                  <label style={{ flex: '1 1 200px' }}>
                    Name
                    <input name="name" placeholder="Member's Name" required />
                  </label>
                  <label style={{ flex: '1 1 150px' }}>
                    Join Date
                    <input name="joinDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
                  </label>
                  <label style={{ flex: '1 1 150px' }}>
                    Leave Date
                    <input name="leaveDate" type="date" placeholder="Active" />
                  </label>
                  <div style={{ flex: '1 1 100%', display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button className="btn btn-success" type="submit">Save Member</button>
                  </div>
                </form>
              )}

              <div className="members-grid">
                {members.map((member) => (
                  <div className="member-item" key={member.id}>
                    <div className="member-header">
                      <strong>{member.name}</strong>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className={`badge ${!member.leave_date ? 'accepted' : 'needs_review'}`}>
                          {!member.leave_date ? 'Active' : 'Archived'}
                        </span>
                        <button 
                          className="btn-delete"
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            color: 'var(--color-danger)', 
                            cursor: 'pointer', 
                            padding: '4px',
                            fontSize: '0.9rem',
                            fontWeight: 'bold',
                            display: 'inline-flex',
                            alignItems: 'center',
                            lineHeight: '1'
                          }}
                          onClick={() => handleRemoveMember(member.id, member.name)}
                          title={`Remove ${member.name}`}
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    
                    <div className="member-dates">
                      Period: {member.join_date} to {member.leave_date || 'Present'}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', marginTop: '6px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                        Parser Name Aliases:
                      </span>
                      
                      <div className="member-aliases">
                        {member.aliases?.map((a) => (
                          <span key={a} className="alias-tag">{a}</span>
                        ))}
                        {!member.aliases?.length && <span className="alias-tag" style={{ fontStyle: 'italic' }}>none</span>}
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <input 
                          type="text" 
                          placeholder="Add alias (e.g. dev's bro)" 
                          style={{ height: '30px', fontSize: '0.8rem', flexGrow: 1 }}
                          value={newAliasValue[member.id] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewAliasValue(prev => ({ ...prev, [member.id]: val }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddAlias(member.id, member.aliases || []);
                            }
                          }}
                        />
                        <button 
                          className="btn" 
                          style={{ height: '30px', minHeight: '30px', padding: '0 10px', fontSize: '0.8rem' }}
                          onClick={() => handleAddAlias(member.id, member.aliases || [])}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="tab-pane">
            <section className="panel" style={{ marginBottom: '24px' }}>
              <h2><AlertTriangle size={18} /> Resolve Import Anomalies</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.9rem', lineHeight: '1.5' }}>
                These transactions were flagged by the CSV parser because they contain formatting warnings, possible duplicate records, or charge members outside their active membership periods. Approved items are moved to MongoDB database status <strong>accepted</strong> and instantly included in balances. Dismissed items are deleted from the database.
              </p>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>CSV Row</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Payer</th>
                      <th>Amount</th>
                      <th>Flagged Reason</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.filter(e => e.status === 'needs_review').map((expense) => (
                      <tr key={expense.id || expense._id}>
                        <td style={{ fontWeight: 700 }}>{expense.source_row || '-'}</td>
                        <td>{expense.expense_date || '-'}</td>
                        <td style={{ fontWeight: 600 }}>{expense.description}</td>
                        <td>{expense.paid_by}</td>
                        <td>{formatCurrency(expense.amount_inr)}</td>
                        <td>
                          <div style={{ color: 'var(--color-warning)', fontSize: '0.82rem', lineHeight: '1.3' }}>
                            ⚠️ {expense.excluded_reason}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button 
                              className="btn btn-success" 
                              style={{ height: '32px', minHeight: '32px', padding: '0 12px', fontSize: '0.8rem' }}
                              onClick={() => handleApproveExpense(expense.id || expense._id)}
                            >
                              Approve
                            </button>
                            <button 
                              className="btn" 
                              style={{ height: '32px', minHeight: '32px', padding: '0 12px', fontSize: '0.8rem', backgroundColor: 'var(--color-danger)', boxShadow: 'none' }}
                              onClick={() => handleRejectExpense(expense.id || expense._id)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!expenses.filter(e => e.status === 'needs_review').length && (
                      <tr>
                        <td colSpan="7" style={{ textAlign: 'center', padding: '40px 0' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <CheckCircle2 size={36} style={{ color: 'var(--color-success)' }} />
                            <strong style={{ fontSize: '1.1rem' }}>No Flagged Items!</strong>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>All transactions in this group are approved and verified.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'importer' && (
          <div className="tab-pane">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
              {/* CSV Upload Console */}
              <section className="panel">
                <h2><FileUp size={18} /> Upload CSV Ledger</h2>
                
                <div className="switch-row">
                  <div className="switch-label">
                    <span>Dry Run Sandbox Mode</span>
                    <small>Validate column headers, name aliases, and active membership dates without saving to MongoDB.</small>
                  </div>
                  <label className="switch-toggle">
                    <input 
                      type="checkbox" 
                      checked={dryRun} 
                      onChange={(e) => setDryRun(e.target.checked)} 
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <form className="import-form" onSubmit={handleImport} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div 
                    className="upload-dropzone"
                    onClick={() => document.getElementById('csv-file-input').click()}
                  >
                    <FileUp size={36} />
                    <span>Click to browse for expenses_export.csv</span>
                    <small>Standard comma-separated file with date, description, paid_by, amount, split_type columns</small>
                    <input 
                      id="csv-file-input"
                      name="file" 
                      type="file" 
                      accept=".csv,text/csv" 
                      style={{ display: 'none' }} 
                      onChange={(e) => {
                        if (e.target.files[0]) {
                          showNotice(`Selected file: ${e.target.files[0].name}`);
                        }
                      }}
                    />
                  </div>

                  <button className="btn" disabled={busy} type="submit" style={{ alignSelf: 'center', width: '200px', justifyContent: 'center' }}>
                    {busy ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
                    {dryRun ? 'Dry Run Validate' : 'Upload & Save'}
                  </button>
                </form>
              </section>

              {/* Import Run Report */}
              {report && (
                <section className="panel">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2>
                      <Info size={18} /> 
                      Import Report {report.run.id === null && <span style={{ color: 'var(--color-warning)', marginLeft: '10px' }}>(DRY RUN PREVIEW)</span>}
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Anomalies detected: <strong style={{ color: 'var(--color-danger)' }}>{report.anomalies.length}</strong>
                    </span>
                  </div>

                  {/* Import statistics */}
                  {report.run.summary && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '10px', marginBottom: '20px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <small style={{ color: 'var(--text-muted)', display: 'block' }}>Total Rows</small>
                        <strong style={{ fontSize: '1.2rem' }}>{report.run.summary.totalRows}</strong>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <small style={{ color: 'var(--text-muted)', display: 'block' }}>Accepted</small>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--color-success)' }}>{report.run.summary.acceptedExpenses}</strong>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <small style={{ color: 'var(--text-muted)', display: 'block' }}>Settlements</small>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--color-primary)' }}>{report.run.summary.settlements}</strong>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <small style={{ color: 'var(--text-muted)', display: 'block' }}>Needs Review</small>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--color-warning)' }}>{report.run.summary.needsReview}</strong>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <small style={{ color: 'var(--text-muted)', display: 'block' }}>Rejected</small>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--color-danger)' }}>{report.run.summary.rejectedRows}</strong>
                      </div>
                    </div>
                  )}

                  <div className="table-container" style={{ maxHeight: '350px' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>CSV Row</th>
                          <th>Problem Type</th>
                          <th>Normaliser Action</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.anomalies.map((item, index) => {
                          const rowNum = item.rowNumber || item.row_number;
                          return (
                            <tr key={`${rowNum}-${item.type}-${index}`}>
                              <td style={{ fontWeight: 700 }}>{rowNum}</td>
                              <td>
                                <span className="badge needs_review" style={{ fontSize: '0.65rem' }}>
                                  {item.type.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td style={{ color: 'var(--color-primary)' }}>{item.action}</td>
                              <td>{item.message}</td>
                            </tr>
                          );
                        })}
                        {!report.anomalies.length && (
                          <tr>
                            <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              No anomalies detected. File is clean.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {activeTab === 'guide' && (
          <div className="tab-pane">
            <section className="panel guide-container">
              <h2><BookOpen size={18} /> MERN System Architecture and Explained Assets</h2>
              
              <div className="guide-section">
                <h3>1. Compiled Frontend Assets Explained (`dist/assets/`)</h3>
                <p>
                  Our React development environment uses a compiler called Vite. The browser doesn't execute JSX or CSS modules natively at scale. When we run <code>npm run build</code>, Vite bundles and minifies everything:
                </p>
                <div className="code-inspector">
                  ⚡ dist/index.html        - Main HTML skeleton linking assets.<br />
                  ⚡ dist/assets/index-*.js  - Compiled React app, packages, Mongoose virtual structures, and icons.<br />
                  ⚡ dist/assets/index-*.css - Minified CSS rules, typography fonts, animations, and CSS grids.
                </div>
                <p style={{ marginTop: '8px' }}>
                  The randomized strings in the file names (e.g. <code>index-CcxHf_o7.js</code>) are content-based hashes. They are used for <strong>cache busting</strong>. When code is updated and built again, the hash changes, forcing user browsers to fetch the fresh bundle instead of serving stale cached resources.
                </p>
              </div>

              <div className="guide-section">
                <h3>2. MongoDB Document Database Schema</h3>
                <p>
                  We migrated the relational SQL database schema into a fast, document-based MongoDB storage engine using Mongoose. The schemas are configured to automatically cast unique string identifiers and output clean JSON virtual objects.
                </p>
                <div className="code-inspector">
                  📂 Users       : name, email, sha-256 password hash.<br />
                  📂 Groups      : name, base_currency (default: INR).<br />
                  📂 Members     : group_id, name, join_date, leave_date, aliases: [String]<br />
                  📂 Expenses    : paid_by, description, amount_inr, split_type, status, shares: [&#123; member, amount &#125;]<br />
                  📂 Settlements : payer, payee, amount_inr, date, description.
                </div>
              </div>

              <div className="guide-section">
                <h3>3. Dynamic CSV Normalisation Importer</h3>
                <p>
                  Instead of referencing a hardcoded membership array, the file importer now queries MongoDB for the active group's member list dynamically:
                </p>
                <div className="code-inspector">
                  1. Loader pulls active Group Members and their custom Aliases from MongoDB.<br />
                  2. Importer builds name normalization maps and membership windows in-memory.<br />
                  3. CSV amounts are cleaned (comma separation removed) and USD is converted to INR.<br />
                  4. Rows are audited; anomalies are logged, and outliers are held in reviews.
                </div>
              </div>

              <div className="guide-section">
                <h3>4. Uniqueness Features for Recruiters</h3>
                <p>
                  🌟 <strong>Interactive Settlement Flowchart:</strong> An SVG-mapped ledger visualizer that computes simplified debts dynamically and lets users settle debts with one click directly into MongoDB.
                  <br />
                  🌟 <strong>Sandbox Dry Run:</strong> Toggle Dry Run mode to preview currency parsing, validations, and anomalies before saving to database collections.
                  <br />
                  🌟 <strong>Multi-Currency Engine:</strong> Recalculate metrics and ledger balances instantly in INR, USD, and EUR.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Real-time Expense Chat & Splits Side Drawer */}
      {selectedExpense && (
        <div className="drawer-overlay" onClick={() => setSelectedExpense(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>Expense Details</h3>
              <button className="btn-close" onClick={() => setSelectedExpense(null)}>✕</button>
            </div>
            
            <div className="drawer-body">
              <div className="drawer-detail-card">
                <span className={`badge ${selectedExpense.status}`} style={{ marginBottom: '8px' }}>{selectedExpense.status}</span>
                <h4>{selectedExpense.description}</h4>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', marginTop: '6px' }}>
                  {formatCurrency(selectedExpense.amount_inr)}
                </div>
                
                <div className="drawer-meta-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                  <div><strong>Paid By:</strong> {selectedExpense.paid_by}</div>
                  <div><strong>Date:</strong> {selectedExpense.expense_date}</div>
                  {selectedExpense.notes && <div><strong>Notes:</strong> {selectedExpense.notes}</div>}
                  {selectedExpense.source_row && <div><strong>CSV Row:</strong> {selectedExpense.source_row}</div>}
                  <div><strong>Split Type:</strong> {selectedExpense.split_type}</div>
                </div>
              </div>

              <div className="drawer-section">
                <h5>Splits & Shares</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', marginTop: '8px' }}>
                  {selectedExpense.shares?.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span>{s.member_name}</span>
                      <strong style={{ color: 'var(--text-main)' }}>{formatCurrency(s.amount_inr)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="drawer-section comment-section">
                <h5>Real-time Chat Comments</h5>
                <div className="comments-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '250px', overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px', marginTop: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                        <strong style={{ color: c.sender === session.user.name ? 'var(--color-primary)' : 'var(--color-success)' }}>{c.sender}</strong>
                        <span style={{ color: 'var(--text-dark)' }}>{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '2px', margin: 0, wordBreak: 'break-word' }}>{c.message}</p>
                    </div>
                  ))}
                  {!comments.length && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: '12px 0' }}>No comments yet. Start the conversation below!</p>
                  )}
                </div>

                <form onSubmit={handlePostComment} style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <input 
                    type="text" 
                    placeholder="Ask a question or comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    style={{ height: '36px', fontSize: '0.85rem' }}
                    required
                  />
                  <button className="btn" type="submit" style={{ height: '36px', padding: '0 12px' }}>Send</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helpers
async function api(path, options) {
  const response = await fetch(`${API_URL}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function simplifyDebtsList(balances) {
  const debtors = balances.filter((row) => row.net < -0.01).map((row) => ({ member: row.member, amount: -row.net }));
  const creditors = balances.filter((row) => row.net > 0.01).map((row) => ({ member: row.member, amount: row.net }));
  const result = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    result.push({ from: debtors[i].member, to: creditors[j].member, amountInr: Math.round(amount * 100) / 100 });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount <= 0.01) i += 1;
    if (creditors[j].amount <= 0.01) j += 1;
  }
  return result;
}

createRoot(document.getElementById('root')).render(<App />);
