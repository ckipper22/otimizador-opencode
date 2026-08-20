import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfigModules = import.meta.glob<{ default: any }>('../../firebase-applet-config.json', { eager: false });

let firebaseConfig: any = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: "",
  firestoreDatabaseId: ""
};

let app: any = null;
let db: any = null;
let auth: any = null;
let googleProvider: any = null;

async function initFirebase() {
  if (typeof window !== 'undefined' && firebaseConfigModules['../../firebase-applet-config.json']) {
    try {
      const configModule = await firebaseConfigModules['../../firebase-applet-config.json']();
      firebaseConfig = configModule.default || configModule;
    } catch {
      // Config file not found, use empty config
    }
  }
  app = initializeApp(firebaseConfig);
  db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
}

initFirebase();

export { app, db, auth, googleProvider };
