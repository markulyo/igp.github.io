/**
 * IGP - Firebase Authentication
 * Integrated Geospatial Platform | National Irrigation Administration
 */

// Inline fallback config
window.AUTH_CONFIG = {
    FIREBASE_API_KEY: "AIzaSyDjhv-uj81Am43MXwRquinlRRoxBE9NGQA",
    FIREBASE_AUTH_DOMAIN: "gettingstartedwithfireba-efd5b.firebaseapp.com",
    FIREBASE_PROJECT_ID: "gettingstartedwithfireba-efd5b",
    FIREBASE_APP_ID: "1:617609354798:web:5f804b34cad0c5f388c9bf",
    FIREBASE_ROLES_CLAIM: "roles",
    FIREBASE_ALLOWED_LOGIN_ROLES: "",
    FIREBASE_ADMIN_EMAILS: "",
    FIREBASE_ANALYST_DOMAIN: "@nia.gov.ph"
};

// Initialize Firebase (only if Firebase SDK is loaded)
if (typeof firebase !== 'undefined') {
    const fbApp = firebase.initializeApp({
        apiKey: AUTH_CONFIG.FIREBASE_API_KEY,
        authDomain: AUTH_CONFIG.FIREBASE_AUTH_DOMAIN,
        projectId: AUTH_CONFIG.FIREBASE_PROJECT_ID,
        appId: AUTH_CONFIG.FIREBASE_APP_ID,
    });
    var fbAuth = firebase.auth(fbApp);
    var db = firebase.firestore(fbApp);
}

let currentUser = null;
let isRegisterMode = false;

/**
 * Ensure user document exists in Firestore
 * @param {object} user - Firebase user
 * @param {string} provider - Provider ID
 */
async function ensureUserDoc(user, provider) {
    try {
        const ref = db.collection('users').doc(user.uid);
        const doc = await ref.get();
        if (!doc.exists) {
            await ref.set({
                email: user.email,
                displayName: user.displayName || user.email,
                photoURL: user.photoURL || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                role: 'viewer',
                provider: provider
            });
            console.log('✅ User profile created in Firestore for', user.email);
        }
    } catch (e) {
        console.warn('[IGP] User doc save failed:', e);
    }
}

/**
 * Get user role from database
 * @param {object} user - Firebase user
 * @returns {string} User role
 */
async function getUserRoleFromDB(user) {
    try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const r = userDoc.data().role;
            if (r) { console.log('[IGP] Role from users doc:', r); return r; }
        }
    } catch (e) {
        console.warn('[IGP] users doc role fetch failed:', e);
    }
    return 'viewer';
}

/**
 * Enter the application after successful login
 * @param {object} user - Firebase user
 * @param {string} role - User role
 */
function enterApp(user, role) {
    currentUser = user;
    role = role || 'viewer';

    // User badge
    const badge = document.getElementById('userBadge');
    badge.style.display = 'flex';
    document.getElementById('userName').textContent = user.displayName || user.email.split('@')[0];
    document.getElementById('userRole').textContent = role.charAt(0).toUpperCase() + role.slice(1);

    // Avatar — photo or initials
    const avatarEl = document.getElementById('userAvatar');
    if (user.photoURL) {
        avatarEl.innerHTML = `<img src="${user.photoURL}" alt="avatar">`;
    } else {
        const initials = (user.displayName || user.email).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        avatarEl.textContent = initials;
    }

    // Apply role-based restrictions
    applyRoleRestrictions(role);

    // Hide login screen, show app
    document.getElementById('loginScreen').style.display = 'none';
    toast('Welcome, ' + (user.displayName || user.email.split('@')[0]) + ' (' + role + ')', 'ok');
}

/**
 * Apply role-based restrictions
 * @param {string} role - User role
 */
function applyRoleRestrictions(role) {
    const isViewer = role === 'viewer';
    window._viewerRestricted = isViewer;

    const restrictedBtns = ['drawBtn', 'drawTbtn', 'exportKmlBtn', 'uploadKmlBtn', 'reportBtn'];
    const hiddenSections = ['coordSearchSection', 'kmlUploadFooter'];

    restrictedBtns.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isViewer) {
            el.classList.add('viewer-disabled');
        } else {
            el.classList.remove('viewer-disabled');
        }
    });

    hiddenSections.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isViewer) el.classList.add('viewer-hidden');
        else el.classList.remove('viewer-hidden');
    });
}

/**
 * Sign in with Google
 */
function signInWithGoogle() {
    setLoginErr('');
    setLoginBtns(true);
    const provider = new firebase.auth.GoogleAuthProvider();
    fbAuth.signInWithPopup(provider)
        .then(async result => {
            const user = result.user;
            await ensureUserDoc(user, 'google');
            const role = await getUserRoleFromDB(user);
            enterApp(user, role);
        })
        .catch(err => { setLoginErr(friendlyError(err)); setLoginBtns(false); });
}

/**
 * Sign in with email/password
 */
function signInWithEmail() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPassword').value;
    if (!email || !pass) { setLoginErr('Please enter email and password.'); return; }
    setLoginErr(''); setLoginBtns(true);

    if (isRegisterMode) {
        fbAuth.createUserWithEmailAndPassword(email, pass)
            .then(async result => {
                const user = result.user;
                await ensureUserDoc(user, 'email');
                const role = await getUserRoleFromDB(user);
                enterApp(user, role);
            })
            .catch(err => { setLoginErr(friendlyError(err)); setLoginBtns(false); });
    } else {
        fbAuth.signInWithEmailAndPassword(email, pass)
            .then(async result => {
                const user = result.user;
                await ensureUserDoc(user, 'email');
                const role = await getUserRoleFromDB(user);
                enterApp(user, role);
            })
            .catch(err => { setLoginErr(friendlyError(err)); setLoginBtns(false); });
    }
}

/**
 * Sign out
 */
function signOut() {
    fbAuth.signOut().then(() => {
        currentUser = null;
        document.getElementById('userBadge').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        setLoginErr('');
        toast('Signed out', 'info');
    });
}

/**
 * Toggle between register and sign in mode
 */
function toggleRegister() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('emailSignInBtn').textContent = isRegisterMode ? 'Create Account' : 'Sign In';
    document.querySelector('.login-toggle').innerHTML = isRegisterMode
        ? 'Already have an account? <u>Sign In</u>'
        : "Don't have an account? <u>Register</u>";
    setLoginErr('');
}

/**
 * Set login error message
 * @param {string} msg - Error message
 */
function setLoginErr(msg) { document.getElementById('loginErr').textContent = msg; }

/**
 * Set login buttons disabled state
 * @param {boolean} disabled - Whether to disable buttons
 */
function setLoginBtns(disabled) {
    document.getElementById('googleSignInBtn').disabled = disabled;
    document.getElementById('emailSignInBtn').disabled = disabled;
}

/**
 * Convert Firebase error to friendly message
 * @param {object} err - Firebase error
 * @returns {string} Friendly error message
 */
function friendlyError(err) {
    const map = {
        'auth/user-not-found': 'No account found for this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/popup-closed-by-user': 'Sign-in popup was closed. Please try again.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
        'auth/invalid-credential': ' Invalid email or password.',
    };
    return map[err.code] || err.message;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const pwEl = document.getElementById('loginPassword');
    if (pwEl) pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') signInWithEmail(); });
    const emEl = document.getElementById('loginEmail');
    if (emEl) emEl.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPassword').focus(); });
});

// Persist session — if already signed in, skip login screen
fbAuth.onAuthStateChanged(async user => {
    if (user) {
        const provider = user.providerData?.[0]?.providerId || 'unknown';
        await ensureUserDoc(user, provider);
        const role = await getUserRoleFromDB(user);
        enterApp(user, role);
    }
});
