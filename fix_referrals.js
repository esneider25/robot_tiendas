require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

console.log('Iniciando proceso de recuperación de referidos...');

const keysDir = path.join(__dirname, 'keys');
const accessPlayKeyPath = path.join(keysDir, 'accessplay.json');
const hasLocalKeys = fs.existsSync(accessPlayKeyPath);
const hasEnvKeys = process.env.ACCESSPLAY_FIREBASE_JSON;

if (!hasLocalKeys && !hasEnvKeys) {
  console.error('❌ ERROR: No se encuentran las credenciales de AccessPlay.');
  process.exit(1);
}

function getFirebaseCreds(envName, filePath) {
  if (process.env[envName]) {
    try {
      return admin.credential.cert(JSON.parse(process.env[envName]));
    } catch (e) {
      console.error(`❌ Error parseando la variable de entorno ${envName}.`);
      process.exit(1);
    }
  }
  return admin.credential.cert(require(filePath));
}

const accessPlayApp = admin.initializeApp({
  credential: getFirebaseCreds('ACCESSPLAY_FIREBASE_JSON', accessPlayKeyPath),
  databaseURL: "https://accesplay-8bf5d-default-rtdb.firebaseio.com"
}, 'AccessPlay');

const db = accessPlayApp.database();

(async function() {
  try {
    console.log("🔍 Escaneando base de datos...");
    const [usersSnap, ordersSnap] = await Promise.all([
      db.ref('users').once('value'),
      db.ref('orders').once('value')
    ]);
    
    const users = usersSnap.val() || {};
    const orders = ordersSnap.val() || {};
    
    const usersWithCompletedOrders = new Set();
    for (const orderId in orders) {
      if (orders[orderId].status === 'completed' && orders[orderId].userId) {
        usersWithCompletedOrders.add(orders[orderId].userId);
      }
    }

    let recompensasEntregadas = 0;

    for (const uid in users) {
      const user = users[uid];
      
      if (user.referredBy && !user.hasMadeFirstPurchase && usersWithCompletedOrders.has(uid)) {
        const refQuerySnap = await db.ref('users').orderByChild('referralCode').equalTo(user.referredBy).once('value');
        
        if (refQuerySnap.exists()) {
          const referrerUid = Object.keys(refQuerySnap.val())[0];
          let exito = false;
          
          await db.ref('users/' + referrerUid).transaction(refUser => {
            if (!refUser) return refUser;
            const role = refUser.role || 'cliente';
            if (!['cliente', 'influencer', 'partner'].includes(role)) return undefined;
            
            const maxRef = (role === 'influencer' || role === 'partner') ? (refUser.referralLimit || 100) : 10;
            if ((refUser.referralsCount || 0) >= maxRef) return undefined;
            
            refUser.points = (refUser.points || 0) + 12;
            refUser.referralsCount = (refUser.referralsCount || 0) + 1;
            refUser.referralsEarnedPoints = (refUser.referralsEarnedPoints || 0) + 12;
            
            if (role === 'influencer' && refUser.referralsCount >= 100) {
              refUser.role = 'partner';
            }
            exito = true;
            return refUser;
          });

          if (exito) {
            await db.ref('users/' + referrerUid + '/transactions').push({
              id: Date.now().toString(),
              type: 'deposit',
              amount: 0,
              description: `Bono referido atrasado (${user.name || user.email || 'Amigo'} / Reintegro Script): +12 PTS`,
              date: Date.now()
            });
            await db.ref('users/' + uid).update({ hasMadeFirstPurchase: true });
            console.log(`✅ Reintegro: +12 PTS al dueño del código ${user.referredBy} por invitar a ${user.email}`);
            recompensasEntregadas++;
          } else {
            await db.ref('users/' + uid).update({ referredBy: null, hasMadeFirstPurchase: true });
          }
        }
      }
    }
    
    if (recompensasEntregadas > 0) {
      console.log(`🎉 ¡Terminado! Se entregaron ${recompensasEntregadas} bonos de referidos atrasados.`);
    } else {
      console.log(`👍 Proceso terminado. No se encontraron referidos atrasados.`);
    }
  } catch(e) {
    console.error("❌ Error durante el proceso:", e);
  } finally {
    process.exit(0);
  }
})();
