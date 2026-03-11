/**
 * IGP - Admin Dashboard
 * Integrated Geospatial Platform | National Irrigation Administration
 */

let currentAdminTab = 'users';

/**
 * Check if current user is admin
 */
function isAdmin() {
    return window.currentUserRole === 'admin';
}

/**
 * Open admin dashboard
 */
function openAdminDashboard() {
    if (!isAdmin()) {
        toast('Admin access required', 'warn');
        return;
    }
    document.getElementById('adminModal').classList.add('show');
    loadAdminData();
}

/**
 * Load admin data
 */
async function loadAdminData() {
    await refreshUserList();
    loadResourceList();
    loadAnalytics();
}

/**
 * Switch admin tabs
 */
function switchAdminTab(tab) {
    currentAdminTab = document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelectorAll('.admin-content').forEach(c => c.style.display = 'none');
    document.getElementById('admin-' + tab).style.display = 'block';
    
    if (tab === 'users') refreshUserList();
    if (tab === 'analytics') loadAnalytics();
}

/**
 * Refresh user list
 */
async function refreshUserList() {
    const userListEl = document.getElementById('userList');
    userListEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Loading users...</div>';
    
    try {
        const snapshot = await db.collection('users').get();
        const users = [];
        snapshot.forEach(doc => {
            users.push({ id: doc.id, ...doc.data() });
        });
        
        if (users.length === 0) {
            userListEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">No users found</div>';
            return;
        }
        
        userListEl.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:1px solid var(--border);text-align:left">
                        <th style="padding:10px">User</th>
                        <th style="padding:10px">Role</th>
                        <th style="padding:10px">Provider</th>
                        <th style="padding:10px">Joined</th>
                        <th style="padding:10px">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr style="border-bottom:1px solid var(--border)">
                            <td style="padding:10px">
                                <div style="font-weight:500">${u.displayName || 'Unknown'}</div>
                                <div style="font-size:11px;color:var(--muted)">${u.email || 'No email'}</div>
                            </td>
                            <td style="padding:10px">
                                <select onchange="updateUserRole('${u.id}', this.value)" 
                                        style="background:var(--panel2);border:1px solid var(--border);padding:4px 8px;border-radius:4px;color:var(--text)">
                                    <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                                    <option value="analyst" ${u.role === 'analyst' ? 'selected' : ''}>Analyst</option>
                                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                </select>
                            </td>
                            <td style="padding:10px;color:var(--muted)">${u.provider || 'email'}</td>
                            <td style="padding:10px;color:var(--muted)">${u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown'}</td>
                            <td style="padding:10px">
                                <button onclick="deleteUser('${u.id}')" 
                                        style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#ef4444;padding:4px 8px;border-radius:4px;cursor:pointer">
                                    🗑
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Error loading users:', err);
        userListEl.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444">Error loading users</div>';
    }
}

/**
 * Update user role
 */
async function updateUserRole(userId, newRole) {
    try {
        await db.collection('users').doc(userId).update({ role: newRole });
        toast('User role updated to ' + newRole, 'ok');
        loadAnalytics();
    } catch (err) {
        console.error('Error updating role:', err);
        toast('Failed to update role', 'err');
        refreshUserList();
    }
}

/**
 * Delete user
 */
async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
        await db.collection('users').doc(userId).delete();
        toast('User deleted', 'ok');
        refreshUserList();
        loadAnalytics();
    } catch (err) {
        console.error('Error deleting user:', err);
        toast('Failed to delete user', 'err');
    }
}

/**
 * Load resource list
 */
function loadResourceList() {
    const resourceListEl = document.getElementById('resourceList');
    
    const resources = LAYER_IDS.map(id => {
        const config = LAYER_CONFIG[id];
        const meta = LAYER_META[id];
        return { id, ...config, ...meta };
    });
    
    resourceListEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
                <tr style="border-bottom:1px solid var(--border);text-align:left">
                    <th style="padding:10px">Layer</th>
                    <th style="padding:10px">Tileset ID</th>
                    <th style="padding:10px">Status</th>
                    <th style="padding:10px">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${resources.map(r => `
                    <tr style="border-bottom:1px solid var(--border)">
                        <td style="padding:10px">
                            <div style="font-weight:500">${r.icon} ${r.name}</div>
                            <div style="font-size:11px;color:var(--muted)">${r.sub}</div>
                        </td>
                        <td style="padding:10px;font-family:monospace;font-size:11px">${r.tilesetId || 'Not configured'}</td>
                        <td style="padding:10px">
                            ${r.tilesetId 
                                ? '<span style="color:#22c55e">✓ Configured</span>' 
                                : '<span style="color:var(--muted)">○ Not set</span>'}
                        </td>
                        <td style="padding:10px">
                            <button onclick="editLayerConfig('${r.id}')" 
                                    style="background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.4);color:#3b82f6;padding:4px 8px;border-radius:4px;cursor:pointer">
                                ✏ Edit
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Edit layer config
 */
function editLayerConfig(layerId) {
    const config = LAYER_CONFIG[layerId];
    const meta = LAYER_META[layerId];
    const newTilesetId = prompt('Enter new Tileset ID for ' + meta.name + ':', config.tilesetId || '');
    
    if (newTilesetId !== null) {
        LAYER_CONFIG[layerId].tilesetId = newTilesetId;
        STATE[layerId].tilesetId = newTilesetId;
        toast('Layer config updated. Refresh to apply.', 'ok');
        loadResourceList();
    }
}

/**
 * Load analytics
 */
async function loadAnalytics() {
    try {
        const userSnapshot = await db.collection('users').get();
        const totalUsers = userSnapshot.size;
        
        const activeUsers = [];
        userSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.lastActive && data.lastActive.seconds > Date.now() / 1000 - 86400 * 7) {
                activeUsers.push(data);
            }
        });
        
        const configuredLayers = LAYER_IDS.filter(id => LAYER_CONFIG[id].tilesetId).length;
        
        document.getElementById('stat-total-users').textContent = totalUsers;
        document.getElementById('stat-active-users').textContent = activeUsers.length;
        document.getElementById('stat-total-layers').textContent = configuredLayers + '/' + LAYER_IDS.length;
        
        let activityHtml = '<div style="color:var(--muted)">No recent activity</div>';
        if (userSnapshot.size > 0) {
            const recent = [];
            userSnapshot.forEach(doc => {
                const data = doc.data();
                recent.push({
                    email: data.email,
                    action: 'Joined',
                    time: data.createdAt ? data.createdAt.seconds * 1000 : 0
                });
            });
            recent.sort((a, b) => b.time - a.time);
            activityHtml = recent.slice(0, 5).map(r => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
                    <span>${r.email}</span>
                    <span style="color:var(--muted)">${r.action} - ${new Date(r.time).toLocaleDateString()}</span>
                </div>
            `).join('');
        }
        document.getElementById('recentActivity').innerHTML = activityHtml;
    } catch (err) {
        console.error('Error loading analytics:', err);
    }
}

/**
 * Track user activity
 */
async function trackUserActivity() {
    if (!currentUser) return;
    try {
        await db.collection('users').doc(currentUser.uid).update({
            lastActive: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        // Ignore errors
    }
}

// Track activity every 5 minutes
setInterval(trackUserActivity, 300000);
