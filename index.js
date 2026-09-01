require('dotenv').config();
process.env.NTBA_FIX_350 = 1; // Apagar el DeprecationWarning de envío de archivos
const admin = require('firebase-admin');
const TelegramBot = require('node-telegram-bot-api');
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const exifr = require('exifr');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ========================================
// 1. CARGAR CLAVES DE FIREBASE
// ========================================
console.log('⏳ Inicializando el Cerebro Central...');

const keysDir = path.join(__dirname, 'keys');
const candyStoreKeyPath = path.join(keysDir, 'candystore.json');
const recargaSharkKeyPath = path.join(keysDir, 'recargashark.json');
const accessPlayKeyPath = path.join(keysDir, 'accessplay.json');

// Verificar si existen las claves locales (o si estamos en producción usando variables de entorno)
const hasLocalKeys = fs.existsSync(candyStoreKeyPath) && fs.existsSync(recargaSharkKeyPath) && fs.existsSync(accessPlayKeyPath);
const hasEnvKeys = process.env.CANDYSTORE_FIREBASE_JSON && process.env.RECARGASHARK_FIREBASE_JSON && process.env.ACCESSPLAY_FIREBASE_JSON;

if (!hasLocalKeys && !hasEnvKeys) {
  console.error('❌ ERROR FATAL: Faltan las credenciales de Firebase.');
  console.error('Debes tener la carpeta "keys" con los JSON o usar variables de entorno (CANDYSTORE_FIREBASE_JSON, etc).');
  process.exit(1);
}

// Función auxiliar para obtener credenciales (Prioriza Variables de Entorno sobre archivos locales)
function getFirebaseCreds(envName, filePath) {
  if (process.env[envName]) {
    try {
      return admin.credential.cert(JSON.parse(process.env[envName]));
    } catch (e) {
      console.error(`❌ Error parseando la variable de entorno ${envName}. Asegúrate de que sea un JSON válido.`);
      process.exit(1);
    }
  }
  return admin.credential.cert(require(filePath));
}

// ========================================
// 2. INICIALIZAR LAS 3 APLICACIONES FIREBASE
// ========================================
const candyStoreApp = admin.initializeApp({
  credential: getFirebaseCreds('CANDYSTORE_FIREBASE_JSON', candyStoreKeyPath),
  databaseURL: "https://candystore-eea7d-default-rtdb.firebaseio.com"
}, 'CandyStore');

const recargaSharkApp = admin.initializeApp({
  credential: getFirebaseCreds('RECARGASHARK_FIREBASE_JSON', recargaSharkKeyPath),
  databaseURL: "https://recargashark-default-rtdb.firebaseio.com"
}, 'RecargaShark');

const accessPlayApp = admin.initializeApp({
  credential: getFirebaseCreds('ACCESSPLAY_FIREBASE_JSON', accessPlayKeyPath),
  databaseURL: "https://accesplay-8bf5d-default-rtdb.firebaseio.com"
}, 'AccessPlay');

console.log('✅ Bases de datos conectadas.');

// ========================================
// 3. CONFIGURAR LOS 3 BOTS DE TELEGRAM
// ========================================
const bots = {
  CandyStore: {
    bot: new TelegramBot(process.env.CANDYSTORE_BOT_TOKEN, { 
      polling: {
        params: { allowed_updates: ['message', 'callback_query'] }
      }
    }),
    chatId: process.env.CANDYSTORE_CHAT_ID,
    emoji: '🍬',
    adminUrl: 'https://candystore-zeta.vercel.app/admin'
  },
  RecargaShark: {
    bot: new TelegramBot(process.env.RECARGASHARK_BOT_TOKEN || '8515103558:AAFMRrUiYRna3PbEbZogrIA-i7vIls0clbY', { 
      polling: {
        params: { allowed_updates: ['message', 'callback_query'] }
      }
    }),
    chatId: process.env.RECARGASHARK_CHAT_ID || '6012452103',
    emoji: '🦈',
    adminUrl: 'https://admin.recargashark.com/admin'
  },
  AccessPlay: {
    bot: new TelegramBot(process.env.ACCESSPLAY_BOT_TOKEN, { 
      polling: {
        params: { allowed_updates: ['message', 'callback_query'] }
      }
    }),
    chatId: process.env.ACCESSPLAY_CHAT_ID,
    emoji: '🎮',
    adminUrl: 'https://www.accesplay.com/admin'
  }
};

console.log('✅ Bots de Telegram configurados.');

// ========================================
// 3.5 VIP CASHBACK & PUNTOS (Replica de data.js para el bot)
// ========================================
const VIP_TIERS = [
  { max: 1, name: 'Novato', cashback: 0 },
  { max: 20, name: 'BRONCE I', cashback: 0.2 },
  { max: 40, name: 'BRONCE II', cashback: 0.4 },
  { max: 60, name: 'BRONCE III', cashback: 0.6 },
  { max: 80, name: 'BRONCE IV', cashback: 0.8 },
  { max: 100, name: 'BRONCE V', cashback: 1.0 },
  { max: 120, name: 'PLATA I', cashback: 1.2 },
  { max: 140, name: 'PLATA II', cashback: 1.4 },
  { max: 160, name: 'PLATA III', cashback: 1.6 },
  { max: 180, name: 'PLATA IV', cashback: 1.8 },
  { max: 200, name: 'PLATA V', cashback: 2.0 },
  { max: 220, name: 'ORO I', cashback: 2.2 },
  { max: 240, name: 'ORO II', cashback: 2.4 },
  { max: 260, name: 'ORO III', cashback: 2.6 },
  { max: 280, name: 'ORO IV', cashback: 2.8 },
  { max: 300, name: 'ORO V', cashback: 3.0 },
  { max: 320, name: 'DIAMANTE I', cashback: 3.2 },
  { max: 340, name: 'DIAMANTE II', cashback: 3.4 },
  { max: 360, name: 'DIAMANTE III', cashback: 3.6 },
  { max: 380, name: 'DIAMANTE IV', cashback: 3.8 },
  { max: Infinity, name: 'DIAMANTE V', cashback: 4.0 }
];

function getVipLevel(spent) {
  for (let i = 0; i < VIP_TIERS.length; i++) {
    if (spent < VIP_TIERS[i].max) {
      return { name: VIP_TIERS[i].name, cashback: VIP_TIERS[i].cashback };
    }
  }
  return { name: 'DIAMANTE V', cashback: 4.0 };
}

/**
 * Aplica puntos AccessPoints y cashback VIP al usuario cuando un pedido es completado.
 * Replica exactamente la lógica de updateOrderStatus en data.js del frontend.
 * Solo se aplica a compras de productos (no wallet-recharge) y usuarios no-revendedores.
 */
async function applyVipRewards(orderData, appInstance, storeName) {
  try {
    // Solo aplicar a compras de productos (no recargas de monedero ni canjes de PIN)
    if (!orderData.userId || orderData.productType === 'wallet-recharge' || orderData.paymentMethodId === 'pin-redemption') return;

    const price = parseFloat(orderData.priceUsd || 0);
    if (price <= 0) return;

    const userRef = appInstance.database().ref('users/' + orderData.userId);
    const userSnap = await userRef.once('value');
    const userData = userSnap.val();
    if (!userData) return;

    const role = userData.role || 'cliente';
    if (role === 'revendedor') return;

    // 1. Calcular puntos
    let earnedPoints = 0;
    if (price < 5) earnedPoints = 2;
    else if (price <= 12) earnedPoints = 4;
    else earnedPoints = 7;

    // 2. Calcular nuevo totalSpent y cashback
    const currentSpent = parseFloat(userData.totalSpent || 0);
    const newSpent = currentSpent + price;

    let cashbackAmount = 0;
    let cashbackPercent = 0;

    // Solo dar cashback si NO se usó código de descuento
    if (!orderData.discountCode) {
      const vip = getVipLevel(newSpent);
      cashbackPercent = vip.cashback || 0;
      if (cashbackPercent > 0) {
        cashbackAmount = price * (cashbackPercent / 100);
      }
    }

    // 3. Aplicar todo con transacción atómica para evitar race conditions
    await userRef.transaction(current => {
      if (current === null) return current;

      current.totalSpent = (parseFloat(current.totalSpent) || 0) + price;
      current.points = (current.points || 0) + earnedPoints;

      if (cashbackAmount > 0) {
        current.wallet = (parseFloat(current.wallet) || 0) + cashbackAmount;
      }

      return current;
    });

    // 4. Registrar la transacción de cashback en el historial (fuera de la transacción)
    if (cashbackAmount > 0) {
      await appInstance.database().ref('users/' + orderData.userId + '/transactions').push({
        id: Date.now().toString(),
        type: 'deposit',
        amount: cashbackAmount,
        description: `Cashback VIP (${cashbackPercent.toFixed(1)}%) por pedido #${orderData.id}`,
        date: Date.now()
      });
    }

    console.log(`🎯 [${storeName}] VIP aplicado a ${orderData.userId}: +${earnedPoints} PTS, totalSpent=$${newSpent.toFixed(2)}${cashbackAmount > 0 ? `, cashback=$${cashbackAmount.toFixed(4)}` : ''}`);

    // 5. Lógica de Comisión para Influencers
    if (orderData.discountCode) {
      const discountsSnap = await appInstance.database().ref('discounts').once('value');
      const discounts = discountsSnap.val();
      if (discounts) {
        const discountObj = Object.values(discounts).find(d => d.code === orderData.discountCode);
        if (discountObj && discountObj.influencerUid && discountObj.commissionRate > 0) {
          const commissionUsd = price * (discountObj.commissionRate / 100);
          const commissionPoints = Math.floor(commissionUsd * 100);
          if (commissionPoints > 0) {
             await appInstance.database().ref('users/' + discountObj.influencerUid + '/points').transaction(current => (current || 0) + commissionPoints);
             console.log(`🌟 [${storeName}] Influencer ${discountObj.influencerUid} recibió ${commissionPoints} PTS por comisión del cupón ${orderData.discountCode}`);
          }
        }
      }
    }
  } catch (e) {
    console.error(`❌ [${storeName}] Error aplicando VIP rewards para #${orderData.id}:`, e.message);
  }
}

// --- NUEVA LÓGICA AGREGADA PARA REFERIDOS Y RECARGAS DE MONEDERO ---
async function applyWalletAndReferralRewards(orderData, appInstance, storeName) {
  try {
    // Los canjes de PIN son premios/regalos, no aplican para monedero ni referidos
    if (!orderData.userId || orderData.paymentMethodId === 'pin-redemption') return;
    const db = appInstance.database();
    const price = parseFloat(orderData.priceUsd || 0);

    // 1. Lógica de Recarga de Monedero
    if (orderData.productType === 'wallet-recharge') {
      await db.ref('users/' + orderData.userId + '/wallet').transaction(current => {
        return (parseFloat(current) || 0) + price;
      });
      await db.ref('users/' + orderData.userId + '/transactions').push({
        id: Date.now().toString(),
        type: 'deposit',
        amount: price,
        description: 'Recarga de monedero aprobada (Bot)',
        date: Date.now()
      });
      console.log(`💰 [${storeName}] Recarga de monedero de $${price} aplicada al usuario ${orderData.userId}`);
    }

    // 2. Lógica de Referidos (Aplica tanto a recargas como a compras)
    const userSnap = await db.ref('users/' + orderData.userId).once('value');
    const p = userSnap.val() || {};
    if (p.referredBy) {
      const refQuerySnap = await db.ref('users').orderByChild('referralCode').equalTo(p.referredBy).once('value');
      if (refQuerySnap.exists()) {
        const referrerUid = Object.keys(refQuerySnap.val())[0];
        const referrerData = refQuerySnap.val()[referrerUid];
        
        const referrerRole = referrerData.role || 'cliente';
        if (referrerRole === 'cliente' || referrerRole === 'influencer' || referrerRole === 'partner') {
          const maxReferrals = (referrerRole === 'influencer' || referrerRole === 'partner') ? (referrerData.referralLimit || 100) : 10;
          let refCount = referrerData.referralsCount || 0;
          let referrerReward = 0;
          let isFirst = false;

          if (!p.hasMadeFirstPurchase) {
            if (refCount >= maxReferrals) {
              await db.ref('users/' + orderData.userId).update({ referredBy: null, hasMadeFirstPurchase: true });
              return;
            }
            referrerReward = 12;
            isFirst = true;
            await db.ref('users/' + orderData.userId).update({ hasMadeFirstPurchase: true });
          } else {
            let baseReward = referrerRole === 'partner' ? 3 : 2;
            if (price >= 2) referrerReward = baseReward;
            else referrerReward = 1;
          }

          if (referrerReward > 0) {
            if (isFirst) refCount++;
            
            await db.ref('users/' + referrerUid).transaction(refUser => {
              if (refUser === null) return refUser;
              refUser.points = (refUser.points || 0) + referrerReward;
              refUser.referralsCount = isFirst ? (refUser.referralsCount || 0) + 1 : (refUser.referralsCount || 0);
              refUser.referralsEarnedPoints = (refUser.referralsEarnedPoints || 0) + referrerReward;
              if (referrerRole === 'influencer' && (refUser.referralsCount || 0) >= 100) {
                refUser.role = 'partner';
              }
              return refUser;
            });

            await db.ref('users/' + referrerUid + '/transactions').push({
              id: Date.now().toString(),
              type: 'deposit',
              amount: 0,
              description: `Bono referido (${p.name || 'Amigo'} / Bot): +${referrerReward} PTS`,
              date: Date.now()
            });
            console.log(`👥 [${storeName}] Referido aplicado para ${referrerUid}: +${referrerReward} PTS`);
          }
        }
      }
    }
  } catch (e) {
    console.error(`❌ [${storeName}] Error en applyWalletAndReferralRewards para #${orderData.id}:`, e.message);
  }
}
// -------------------------------------------------------------------

// ========================================
// 4. FUNCIONES AUXILIARES (DESCARGA DE IMAGEN Y OCR)
// ========================================

// Función para descargar imagen a un buffer temporal (ahora soporta Base64)
async function getImageBuffer(screenshotStr) {
  if (!screenshotStr) return null;

  // Si es un string Base64 (data:image/jpeg;base64,...)
  if (screenshotStr.startsWith('data:image')) {
    const base64Data = screenshotStr.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, 'base64');
  }

  // Si es una URL HTTP normal
  if (screenshotStr.startsWith('http')) {
    return new Promise((resolve, reject) => {
      https.get(screenshotStr, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error('Falló la descarga de la imagen. Status: ' + response.statusCode));
        }
        const data = [];
        response.on('data', (chunk) => data.push(chunk));
        response.on('end', () => resolve(Buffer.concat(data)));
      }).on('error', reject);
    });
  }

  return null;
}

// Función para extraer números de referencia usando Tesseract
async function performOCR(imageBuffer) {
  console.log('🔍 Iniciando lectura OCR...');
  try {
    // PREPROCESAMIENTO DE IMAGEN PARA MEJORAR OCR
    console.log('🖼️ Procesando imagen para mejorar legibilidad...');
    const image = await Jimp.read(imageBuffer);
    
    // Escalar la imagen x2, ponerla en escala de grises y subir el contraste
    // Esto ayuda muchísimo a fuentes delgadas como la del BDV
    image.scale(2)
         .greyscale()
         .contrast(0.2)
         .normalize();

    // Obtener el nuevo buffer procesado
    const processedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);

    const worker = await Tesseract.createWorker('spa');
    const { data: { text } } = await worker.recognize(processedBuffer);
    await worker.terminate();

    console.log('📝 Texto extraído por OCR:\n', text);

    // Normalizar texto (minúsculas y sin acentos básicos)
    let normalizedText = text.toLowerCase()
      .replace(/[áäâà]/g, 'a').replace(/[éëêè]/g, 'e').replace(/[íïîì]/g, 'i')
      .replace(/[óöôò]/g, 'o').replace(/[úüûù]/g, 'u');

    // Corregir errores comunes de OCR en números (o -> 0, i/l -> 1, s -> 5, b -> 8) si están pegados a otros números
    normalizedText = normalizedText
      .replace(/(?<=\d)o|o(?=\d)/g, '0')
      .replace(/(?<=\d)[il]|[il](?=\d)/g, '1')
      .replace(/(?<=\d)s|s(?=\d)/g, '5')
      .replace(/(?<=\d)z|z(?=\d)/g, '2')
      .replace(/(?<=\d)b|b(?=\d)/g, '8')
      .replace(/(?<=\d)g|g(?=\d)/g, '9');

    // Expresión regular mejorada para bancos (incluye recibo, comprobante, transaccion)
    // Se cambia a \d{5,25} para EVITAR capturar años (ej. 2024, 2026) que tienen 4 dígitos
    const keywordRegex = /(?:referencia|ref\.|ref|recibo|comprobante|transaccion|aprobacion|numero\s+de\s+operacion|operacion|tipo\s+de\s+operacion|numero\s+de\s+referencia)[\s\S]{0,35}?(\d{5,25})/gi;
    
    let ocrNumbers = [];
    let match;
    
    // Buscar todas las coincidencias
    while ((match = keywordRegex.exec(normalizedText)) !== null) {
      ocrNumbers.push(match[1]);
    }

    // Eliminar duplicados si hay varios
    if (ocrNumbers.length > 0) {
      ocrNumbers = [...new Set(ocrNumbers)];
    } else {
      console.log('⚠️ Palabras clave no encontradas. (Fuerza bruta desactivada por seguridad)');
    }

    console.log('✅ OCR Terminado. Referencias encontradas:', ocrNumbers);
    return ocrNumbers;
  } catch (error) {
    console.error('❌ Error en OCR:', error);
    return [];
  }
}

// ========================================
// 4.3 PARSEO DE NOTIFICACIONES BANCARIAS (BDV)
// ========================================

/**
 * Parsea el texto de una notificación del Banco de Venezuela (BDV).
 * Soporta 3 formatos:
 *   1. PagomovilBDV: "Recibiste un PagomovilBDV por Bs.874,00 del 0414-1649377 Ref: 924138321095 ..."
 *   2. Transferencia otros bancos: "Recibiste una transferencia de otros bancos de NOMBRE por Bs. 873,60 bajo el número de operación 00516851."
 *   3. Transferencia BDV: "Recibiste una transferencia BDV de NOMBRE por Bs.2.345,00 bajo el numero de operacion 059133209947"
 *
 * @param {string} title - Título de la notificación (ej: "PagomovilBDV recibido")
 * @param {string} text  - Cuerpo de la notificación
 * @returns {{ ref: string, amountBs: number, type: string, name: string|null, phone: string|null } | null}
 */
function parseBankNotification(title, text) {
  if (!text) return null;

  // Limpiar comillas que a veces envuelven el texto de transferencias BDV
  const cleanText = text.replace(/^["']|["']$/g, '').trim();
  const titleLower = (title || '').toLowerCase();

  // ── Formato 1: PagomovilBDV ──
  // "Recibiste un PagomovilBDV por Bs.874,00 del 0414-1649377 Ref: 924138321095 en fecha ..."
  if (titleLower.includes('pagomovil') || cleanText.toLowerCase().includes('pagomovilbdv')) {
    const amountMatch = cleanText.match(/por\s+Bs\.?\s*([\d.,]+)/i);
    const phoneMatch = cleanText.match(/del\s+([\d-]+)/i);
    const refMatch = cleanText.match(/Ref:\s*(\d+)/i);

    if (amountMatch && refMatch) {
      return {
        ref: refMatch[1].trim(),
        amountBs: parseBsAmount(amountMatch[1]),
        type: 'pagomovil',
        name: null,
        phone: phoneMatch ? phoneMatch[1].trim() : null
      };
    }
  }

  // ── Formato 2: Transferencia de otros bancos ──
  // "Recibiste una transferencia de otros bancos de NOMBRE por Bs. 873,60 bajo el número de operación 00516851."
  if (titleLower.includes('otros bancos') || cleanText.toLowerCase().includes('transferencia de otros bancos')) {
    const match = cleanText.match(/transferencia de otros bancos de\s+(.+?)\s+por\s+Bs\.?\s*([\d.,]+)\s+bajo\s+(?:el\s+)?n[uú]mero\s+de\s+operaci[oó]n\s+(\d+)/i);
    if (match) {
      return {
        ref: match[3].trim(),
        amountBs: parseBsAmount(match[2]),
        type: 'transferencia_otros',
        name: match[1].trim(),
        phone: null
      };
    }
  }

  // ── Formato 3: Transferencia BDV (mismo banco) ──
  // "Recibiste una transferencia BDV de NOMBRE por Bs.2.345,00 bajo el numero de operacion 059133209947"
  if (titleLower.includes('transferencia bdv') || cleanText.toLowerCase().includes('transferencia bdv')) {
    const match = cleanText.match(/transferencia\s+BDV\s+de\s+(.+?)\s+por\s+Bs\.?\s*([\d.,]+)\s+bajo\s+(?:el\s+)?numero\s+de\s+operacion\s+(\d+)/i);
    if (match) {
      return {
        ref: match[3].trim(),
        amountBs: parseBsAmount(match[2]),
        type: 'transferencia_bdv',
        name: match[1].trim(),
        phone: null
      };
    }
  }

  // ── No reconocido ──
  return null;
}

/**
 * Convierte un string de monto en Bs venezolano a número.
 * Maneja formatos como: "874,00", "2.345,00", "873,60", "460.621,98"
 * En Venezuela: punto = separador de miles, coma = decimales.
 */
function parseBsAmount(amountStr) {
  if (!amountStr) return 0;
  // Quitar puntos de miles, reemplazar coma decimal por punto
  const cleaned = amountStr.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ========================================
// 4.5 SISTEMA ANTI-XSS Y LIMPIEZA AUTOMÁTICA
// ========================================

// Patrones sospechosos que indican inyección XSS / ataques
const XSS_PATTERNS = [
  /<script/i,
  /javascript\s*:/i,
  /on(?:error|load|click|mouseover|focus|blur)\s*=/i,
  /eval\s*\(/i,
  /document\./i,
  /window\./i,
  /\.src\s*=/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /\.cookie/i,
  /atob\s*\(/i,
  /btoa\s*\(/i,
  /String\.fromCharCode/i,
  /\balert\s*\(/i,
  /\bprompt\s*\(/i,
  /\bconfirm\s*\(/i,
  /getIdToken/i,
  /\.auth\(\)/i,
  /webhook\./i,
  /new\s+Image\s*\(/i,
  /encodeURIComponent/i,
  /<img[^>]+onerror/i,
  /<iframe/i,
  /<svg[^>]+onload/i
];

/**
 * Detecta si un pedido contiene payloads XSS/inyección en cualquiera de sus campos de texto.
 * Revisa: gameId, playerName, customerContact, accountEmail, productName, packageLabel, adminNote
 */
function isSuspiciousOrder(order) {
  if (!order) return false;
  const fieldsToCheck = [
    order.gameId, order.playerName, order.customerContact,
    order.accountEmail, order.productName, order.packageLabel,
    order.adminNote, order.id
  ];
  for (const field of fieldsToCheck) {
    if (!field || typeof field !== 'string') continue;
    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(field)) return true;
    }
  }
  return false;
}

/**
 * Limpieza automática al iniciar: busca y elimina pedidos con IDs tipo XSS
 * o contenido malicioso de las 3 bases de datos.
 */
async function cleanupMaliciousOrders() {
  console.log('\n🧹 Iniciando limpieza de pedidos maliciosos (XSS)...');
  const stores = [
    { name: 'CandyStore', app: candyStoreApp },
    { name: 'RecargaShark', app: recargaSharkApp },
    { name: 'AccessPlay', app: accessPlayApp }
  ];

  let totalDeleted = 0;

  for (const store of stores) {
    try {
      const ordersRef = store.app.database().ref('orders');
      const snapshot = await ordersRef.once('value');
      const allOrders = snapshot.val();
      if (!allOrders) continue;

      const toDelete = [];
      for (const [orderId, orderData] of Object.entries(allOrders)) {
        // Criterio 1: El ID contiene "XSS" (pedidos de test)
        const hasXssId = /xss/i.test(orderId);
        // Criterio 2: El contenido tiene payloads maliciosos
        const hasMaliciousContent = isSuspiciousOrder(orderData);

        if (hasXssId || hasMaliciousContent) {
          toDelete.push(orderId);
        }
      }

      if (toDelete.length > 0) {
        console.log(`🚨 [${store.name}] Encontrados ${toDelete.length} pedidos maliciosos. Eliminando...`);
        const updates = {};
        for (const id of toDelete) {
          updates[id] = null; // null = eliminar en Firebase
          console.log(`   🗑️ Eliminando: #${id}`);
        }
        await ordersRef.update(updates);
        totalDeleted += toDelete.length;
        console.log(`✅ [${store.name}] ${toDelete.length} pedidos maliciosos eliminados.`);
      } else {
        console.log(`✅ [${store.name}] Limpio. No se encontraron pedidos maliciosos.`);
      }
    } catch (err) {
      console.error(`❌ [${store.name}] Error durante limpieza:`, err.message);
    }
  }

  console.log(`🧹 Limpieza completada. Total eliminados: ${totalDeleted}\n`);
  return totalDeleted;
}

// ========================================
// 5. PROCESAMIENTO PRINCIPAL DE PEDIDOS
// ========================================

const pendingOrderIds = new Set();
const processingLocks = new Set(); // Candado anti-duplicados

// Sistema de Cola (Queue) para procesar de 1 en 1 y no saturar la memoria RAM
class PromiseQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }
  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await task()); } 
        catch (err) { reject(err); }
      });
      this.dequeue();
    });
  }
  dequeue() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    this.running++;
    const task = this.queue.shift();
    task().finally(() => {
      this.running--;
      this.dequeue();
    });
  }
}
const orderQueue = new PromiseQueue(1);

async function processNewOrder(orderId, storeName, appInstance, eventType) {
  const dbRef = appInstance.database().ref('orders/' + orderId);
  const snapshot = await dbRef.once('value');
  const order = snapshot.val();

  if (!order || order.botProcessed) return;

  // 🛡️ FILTRO ANTI-XSS: Detectar y eliminar pedidos con payloads maliciosos
  if (/xss/i.test(orderId) || isSuspiciousOrder(order)) {
    console.log(`🚨 [Seguridad] Pedido MALICIOSO detectado: #${orderId}. Eliminando de la base de datos...`);
    await dbRef.remove();
    return;
  }

  // Filtrar pedidos antiguos (más de 6 horas) que no fueron procesados por el bot (para evitar spam en reinicios)
  if (order.createdAt) {
      const orderDate = new Date(order.createdAt).getTime();
      if (!isNaN(orderDate)) {
          const ageHours = (Date.now() - orderDate) / (1000 * 60 * 60);
          if (ageHours > 6) {
              console.log(`🛡️ [Filtro] Pedido antiguo #${orderId} detectado (${Math.round(ageHours)} hrs). Marcando silenciosamente.`);
              await dbRef.update({ botProcessed: true });
              return;
          }
      }
  }

  // Si tiene la captura, lo procesamos INMEDIATAMENTE
  if (order.screenshot) {
    if (pendingOrderIds.has(orderId)) {
      pendingOrderIds.delete(orderId);
    }
    orderQueue.add(() => executeProcess(order, storeName, dbRef));
    return;
  }

  // Si pagó con monedero o saldo, o si ya fue procesado automáticamente (status no es pending), lo procesamos INMEDIATAMENTE
  const isWallet = order.paymentMethodId === 'wallet' || order.paymentMethodId === 'pin-redemption' || (order.paymentMethodName && order.paymentMethodName.toLowerCase().includes('monedero'));
  const isAlreadyProcessed = order.status !== 'pending';

  if (isWallet || isAlreadyProcessed) {
    if (pendingOrderIds.has(orderId)) pendingOrderIds.delete(orderId);
    if (isWallet) {
      console.log(`⚡ [${storeName}] Pedido #${orderId} pagado con Monedero/PIN. Añadiendo a la cola sin foto.`);
    } else {
      console.log(`⏩ [${storeName}] Pedido #${orderId} ya estaba en estado '${order.status}'. Añadiendo a la cola sin foto.`);
    }
    orderQueue.add(() => executeProcess(order, storeName, dbRef));
    return;
  }

  // ── CHECK DEL BAÚL DE PAGOS BANCARIOS (Solo AccessPlay, pedidos pending no-wallet) ──
  if (storeName === 'AccessPlay' && order.status === 'pending') {
    const orderRefs = [];
    if (Array.isArray(order.ocrNumbers)) orderRefs.push(...order.ocrNumbers.map(r => String(r).trim()));
    if (order.manualRef) orderRefs.push(String(order.manualRef).trim());

    if (orderRefs.length > 0) {
      try {
        const vaultRef = appInstance.database().ref('bank_vault');
        const vaultSnap = await vaultRef.once('value');
        const vaultData = vaultSnap.val();

        if (vaultData) {
          for (const [vaultKey, vaultEntry] of Object.entries(vaultData)) {
            if (vaultEntry.used) continue; // Ya fue usada

            const vaultRefStr = String(vaultEntry.ref || '').trim();
            if (!vaultRefStr) continue;

            const refMatch = orderRefs.some(r => r === vaultRefStr);
            if (!refMatch) continue;

            // Verificar monto: pagó al menos el 99% del precio (pagar de más siempre es OK)
            if (order.priceBs) {
              const expectedBs = parseFloat(order.priceBs);
              const minAcceptable = expectedBs * 0.99; // 1% menos permitido
              if (vaultEntry.amountBs < minAcceptable) {
                console.log(`⚠️ [AccessPlay] Vault ref ${vaultRefStr} coincide con #${orderId} pero monto insuficiente: Banco=Bs.${vaultEntry.amountBs} vs Mínimo=Bs.${minAcceptable.toFixed(2)}`);
                continue;
              }
            }

            // ¡Match! Pago adelantado encontrado
            console.log(`🏦✅ [AccessPlay] Pago adelantado encontrado en vault para pedido #${orderId} (Ref: ${vaultRefStr})`);

            // Marcar como usada en vault
            await vaultRef.child(vaultKey).update({ used: true, matchedOrder: orderId });

            // Marcar botProcessed para que el flujo normal no lo procese también
            await dbRef.update({ botProcessed: true });

            // Auto-aprobar
            const bankInfo = {
              ref: vaultEntry.ref,
              amountBs: vaultEntry.amountBs,
              type: vaultEntry.type || 'desconocido',
              name: vaultEntry.name || null,
              phone: vaultEntry.phone || null
            };

            autoApproveOrder(orderId, 'AccessPlay', bankInfo).catch(e => {
              console.error(`❌ [AccessPlay] Error auto-aprobando desde vault para #${orderId}:`, e);
            });
            return; // Salir de processNewOrder, ya se encargó autoApproveOrder
          }
        }
      } catch(e) {
        console.error(`Error revisando bank_vault para #${orderId}:`, e);
      }
    }
  }

  // Si no tiene captura y es el primer aviso, implementamos el ciclo de búsqueda de 60 segundos
  if (eventType === 'child_added' && !pendingOrderIds.has(orderId)) {
    pendingOrderIds.add(orderId);
    console.log(`🔍 [${storeName}] Pedido #${orderId} registrado. Buscando foto en Storage...`);
    
    const screenshotUrl = `https://firebasestorage.googleapis.com/v0/b/accesplay-8bf5d.firebasestorage.app/o/orders_screenshots%2F${orderId}.jpg?alt=media`;
    let attempts = 0;
    const maxAttempts = 12; // 12 * 5s = 60 segundos (1 minuto de espera máxima)
    
    const pollImage = async () => {
      try {
        // Añadir timestamp para evitar que Firebase guarde en caché el error "404 Not Found" (cache busting)
        const timestampedUrl = `${screenshotUrl}&t=${Date.now()}`;
        const imageBuffer = await getImageBuffer(timestampedUrl);
        
        if (imageBuffer && pendingOrderIds.has(orderId)) {
          pendingOrderIds.delete(orderId);
          console.log(`✅ [${storeName}] Foto encontrada para #${orderId} (Intento ${attempts + 1}). Añadiendo a la cola...`);
          order.screenshot = timestampedUrl;
          orderQueue.add(() => executeProcess(order, storeName, dbRef, imageBuffer));
        }
      } catch (e) {
        attempts++;
        if (attempts >= maxAttempts) {
          if (pendingOrderIds.has(orderId)) {
            pendingOrderIds.delete(orderId);
            console.log(`⚠️ [${storeName}] Expiró el tiempo de espera (1 minuto) para #${orderId}. Procesando sin foto.`);
            order.screenshot = null;
            orderQueue.add(() => executeProcess(order, storeName, dbRef));
          }
        } else {
          // Volver a intentar en 5 segundos
          setTimeout(pollImage, 5000);
        }
      }
    };
    
    pollImage();
  }
}

async function executeProcess(order, storeName, dbRef, preFetchedBuffer = null) {
  // Candado de seguridad supremo para evitar duplicados
  if (processingLocks.has(order.id)) {
    console.log(`🛡️ [Seguridad] Se bloqueó un intento de procesamiento duplicado para #${order.id}`);
    return;
  }
  processingLocks.add(order.id);

  console.log(`\n🔔 [${storeName}] Procesando pedido definitivo: #${order.id}`);
  
  // Refrescar estado justo antes de enviar a Telegram (por si el frontend lo auto-completó)
  const freshSnap = await dbRef.once('value');
  const freshOrder = freshSnap.val();
  if (freshOrder) {
    order = freshOrder;
  }

  await dbRef.update({ botProcessed: true });

  let ocrResult = [];
  let imageBuffer = preFetchedBuffer;

  if (!imageBuffer && order.screenshot) {
    try {
      console.log(`🖼️ Analizando imagen para #${order.id}...`);
      imageBuffer = await getImageBuffer(order.screenshot);
    } catch (e) {
      console.error('❌ Error descargando la imagen:', e.message);
    }
  }
  
  let duplicateOrders = [];
  let exifrWarning = '';

  if (imageBuffer) {
    try {
      const exifrData = await exifr.parse(imageBuffer).catch(() => null);
      if (exifrData) {
        const software = (exifrData.Software || exifrData.CreatorTool || exifrData.ProcessingSoftware || '').toLowerCase();
        if (software.includes('photoshop') || software.includes('canva') || software.includes('picsart') || software.includes('illustrator') || software.includes('paint')) {
          exifrWarning = `⚠️ ALERTA: Imagen posiblemente editada con ${exifrData.Software || exifrData.CreatorTool}`;
        }
      }
    } catch(e) {}

    try {
      ocrResult = await performOCR(imageBuffer);
    } catch (e) {
      console.error('❌ Error OCR:', e.message);
    }
  }

  // Combinar referencias del OCR con las enviadas desde el frontend o ingresadas manualmente
  let finalOcrNumbers = [...ocrResult];
  if (Array.isArray(order.ocrNumbers)) {
    order.ocrNumbers.forEach(num => {
      if (num && !finalOcrNumbers.includes(String(num).trim())) {
        finalOcrNumbers.push(String(num).trim());
      }
    });
  }
  if (order.manualRef && !finalOcrNumbers.includes(String(order.manualRef).trim())) {
    finalOcrNumbers.push(String(order.manualRef).trim());
  }

  if (finalOcrNumbers.length > 0) {
    await dbRef.update({ ocrNumbers: finalOcrNumbers });
    
    // Buscar si esta referencia ya existe en otros pedidos (últimos 150 pedidos)
    try {
      const snap = await dbRef.parent.orderByChild('createdAt').limitToLast(150).once('value');
      const allOrders = snap.val() || {};
      for (const [key, oldOrder] of Object.entries(allOrders)) {
        if (key === order.id) continue;
        if (oldOrder.ocrNumbers && Array.isArray(oldOrder.ocrNumbers)) {
           const hasDuplicate = finalOcrNumbers.some(num => oldOrder.ocrNumbers.includes(num));
           if (hasDuplicate) {
             duplicateOrders.push(key);
           }
        }
      }
    } catch (e) {
      console.error('Error buscando duplicados:', e);
    }
  }

  // AUTO-API PARA PAGOS CON MONEDERO (Si la API está encendida)
  const appInstance = storeApps[storeName];
  if ((order.paymentMethodId === 'wallet' || order.paymentMethodId === 'pin-redemption') && order.status === 'pending') {
    const apiConfigsSnap = await appInstance.database().ref('api_configs').once('value');
    const apiConfigs = apiConfigsSnap.val() || [];
    const apiIdx = parseInt(order.apiProvider);
    
    if (!isNaN(apiIdx) && apiConfigs[apiIdx] && apiConfigs[apiIdx].enabled) {
      console.log(`⚡ [${storeName}] API habilitada. Disparando recarga automática para pedido de monedero #${order.id}`);
      try {
        const apiRes = await processApiTopupFromTelegram(order, appInstance);
        order.status = apiRes.status;
        order.adminNote = apiRes.dbNote;
        const statusHistory = order.statusHistory || [];
        statusHistory.push({
          status: apiRes.status,
          timestamp: new Date().toISOString(),
          note: apiRes.dbNote
        });
        await dbRef.update({
          status: apiRes.status,
          adminNote: apiRes.dbNote,
          updatedAt: new Date().toISOString(),
          statusHistory: statusHistory
        });
        
        if (apiRes.status === 'completed') {
          await applyVipRewards(order, appInstance, storeName);
          await applyWalletAndReferralRewards(order, appInstance, storeName);
        }

        // --- ENVIAR NOTIFICACIÓN AL USUARIO TRAS AUTO-DISPATCH ---
        if (apiRes.status === 'completed' || apiRes.status === 'rejected' || apiRes.status === 'invalid-id' || apiRes.status === 'processing') {
            if (appInstance && order.userId) {
                const statusLabels = { processing: 'Procesando ⚙️', completed: 'Completado ✅', rejected: 'Rechazado ❌', 'invalid-id': 'ID Inválido ⚠️' };
                const statusText = statusLabels[apiRes.status] || apiRes.status.toUpperCase();
                
                let title = 'Actualización de Pedido 📦';
                let type = 'order';
                let body = `Tu pedido de ${order.productName || 'producto'} ahora está: ${statusText}.`;
                
                if (apiRes.status === 'completed' && order.productType === 'wallet-recharge') {
                    title = 'Recarga Exitosa 💵';
                    body = `Tu recarga de monedero por $${parseFloat(order.priceUsd||0).toFixed(2)} ha sido procesada con éxito.`;
                    type = 'wallet';
                } else if (apiRes.status === 'rejected') {
                    title = 'Pedido Rechazado ❌';
                    body = `Tu pedido de ${order.productName || 'producto'} ha sido rechazado. Nota: ${apiRes.dbNote || 'Sin nota'}`;
                } else if (apiRes.status === 'invalid-id') {
                    title = 'ID Inválido ⚠️';
                    body = `El ID proporcionado para ${order.productName || 'tu pedido'} es inválido. Nota: ${apiRes.dbNote || 'Verifica tu ID'}`;
                } else if (apiRes.status === 'completed') {
                    title = 'Pedido Completado ✅';
                    body = `Tu pedido de ${order.productName || 'producto'} ha sido procesado con éxito.${apiRes.dbNote ? ` Nota: ${apiRes.dbNote}` : ''}`;
                }

                await appInstance.database().ref('users/' + order.userId + '/notifications').push({
                    title: title,
                    body: body,
                    type: type,
                    timestamp: new Date().toISOString(),
                    read: false
                }).catch(e => console.error('Error enviando notificación en auto-dispatch:', e));
                console.log(`🔔 Notificación de ${apiRes.status} enviada al usuario ${order.userId} desde auto-dispatch`);
            }
        }

      } catch(e) {
        console.error('Error auto-disparando API para monedero:', e);
      }
    }
  }

  await sendTelegramNotification(order, storeName, finalOcrNumbers, imageBuffer, duplicateOrders, exifrWarning, dbRef);

  if (order.status === 'processing' && order.paymentMethodId === 'wallet') {
      console.log(`[${storeName}] Pedido #${order.id} de monedero quedó PROCESANDO. Iniciando Polling automático.`);
      pollApiStatus(order.id, order, appInstance, storeName, bots[storeName].chatId, null).catch(console.error);
  }
}

// ========================================
// 6. ENVIAR A TELEGRAM
// ========================================

async function sendTelegramNotification(order, storeName, ocrResult, imageBuffer, duplicateOrders = [], exifrWarning = '', dbRef = null) {
  const storeConfig = bots[storeName];
  if (!storeConfig || !storeConfig.bot || !storeConfig.chatId) {
    console.error(`❌ Faltan datos de Telegram para ${storeName}`);
    return;
  }

  // Función para escapar caracteres HTML conflictivos
  const escapeHtml = (text) => {
    if (!text) return text;
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  // Armar el mensaje

  let msg = `${storeConfig.emoji} <b>NUEVO PEDIDO [${storeName.toUpperCase()}] — #${order.id}</b>\n`;
  msg += `👤 <b>Jugador/Cliente:</b> ${escapeHtml(order.playerName || order.customerContact || 'ㅤ')}\n`;
  msg += `🆔 <b>ID / Correo:</b> <code>${escapeHtml(order.gameId || order.accountEmail || 'N/A')}</code>\n`;
  msg += `🔥 <b>Producto:</b> ${escapeHtml(order.productName)} (${escapeHtml(order.packageLabel)})\n`;
  let montoText = `$${(order.priceUsd || 0).toFixed(2)} USD`;
  if (order.priceBs) {
    montoText += ` | Bs. ${parseFloat(order.priceBs).toFixed(2)}`;
  }
  msg += `💰 <b>Monto:</b> ${montoText}\n`;
  
  if (order.discountCode) {
    msg += `🎁 <b>Descuento:</b> ${order.discountCode}\n`;
  }

  const isManual = !!(order.manualRef || (!order.screenshot && order.ocrNumbers && order.ocrNumbers.length > 0));
  let refText = 'No detectado / Ver foto';
  if (ocrResult && ocrResult.length > 0) {
    refText = ocrResult.join(', ') + (isManual ? ' ✍️ (Manual)' : '');
  }
  msg += `🔢 <b>Referencia Leída (OCR):</b> <code>${refText}</code>\n`;
  
  if (duplicateOrders.length > 0) {
    msg += `🚨 <b>¡ALERTA DE FRAUDE!</b> Esta referencia ya fue usada en: <b>${duplicateOrders.join(', ')}</b>\n`;
  }

  if (exifrWarning !== '') {
    msg += `🚨 <b>¡ALERTA EXIF!</b> ${exifrWarning}\n`;
  }

  msg += `🏦 <b>Método:</b> ${order.paymentMethodName || 'Desconocido'}\n`;
  msg += `📱 <b>Contacto:</b> ${order.customerContact || 'N/A'}\n`;

  let inline_keyboard = [];
  if (order.status !== 'pending') {
    let stateText = '✅ COMPLETADO';
    if (order.status === 'processing') stateText = '⏳ PROCESANDO...';
    else if (order.status === 'rejected') stateText = '❌ RECHAZADO';
    else if (order.status === 'invalid-id') stateText = '❌ ID INVÁLIDO';

    if (order.status === 'completed' && order.paymentMethodId === 'wallet') {
      stateText = '✅ Pagado con Monedero (Automático)';
    }

    inline_keyboard = [
       [{ text: stateText, callback_data: 'ignore' }],
       [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
    ];
  } else {
    if (order.paymentMethodId === 'wallet') {
      inline_keyboard = [
         [{ text: '⏳ Auto-Procesando...', callback_data: 'ignore' }],
         [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
      ];
    } else {
      inline_keyboard = [
         [
           { text: '✅ Aprobar', callback_data: `approve_${order.id}` },
           { text: '❌ Rechazar', callback_data: `reject_${order.id}` }
         ],
         [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
      ];
    }
  }

  // Opciones de botones para el mensaje
  const options = {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: inline_keyboard
    }
  };

  try {
    let sentMsg;
    if (imageBuffer) {
      // Enviar foto con el mensaje como pie de foto (caption)
      options.caption = msg;
      try {
        sentMsg = await storeConfig.bot.sendPhoto(storeConfig.chatId, imageBuffer, options, { filename: 'comprobante.jpg', contentType: 'image/jpeg' });
      } catch (photoErr) {
        console.error(`⚠️ [${storeName}] Error enviando foto, intentando solo texto. Detalles:`, photoErr.message);
        sentMsg = await storeConfig.bot.sendMessage(storeConfig.chatId, msg, { parse_mode: 'HTML', reply_markup: options.reply_markup });
      }
    } else {
      // Enviar solo texto
      sentMsg = await storeConfig.bot.sendMessage(storeConfig.chatId, msg, options);
    }
    
    if (sentMsg && sentMsg.message_id && dbRef) {
      await dbRef.update({ telegramMessageId: sentMsg.message_id });
    }
    console.log(`✅ [${storeName}] Notificación enviada a Telegram.`);
  } catch (error) {
    console.error(`❌ [${storeName}] Error enviando a Telegram:`, error.message);
  }

  // ── Recordatorio a los 2 minutos para pedidos que quedan PENDIENTES ──
  if (order.status === 'pending' && order.paymentMethodId !== 'wallet' && dbRef) {
    setTimeout(async () => {
      try {
        const snap = await dbRef.once('value');
        const checkOrder = snap.val();
        // Si después de 2 minutos SIGUE pendiente (no lo han aprobado ni manual ni automáticamente por banco)
        if (checkOrder && checkOrder.status === 'pending') {
          const reminderMsg = `⏰ <b>RECORDATORIO</b>: El pedido <b>#${order.id}</b> sigue PENDIENTE de aprobación.\n\n` +
            `<i>Han pasado 2 minutos y no se ha encontrado el pago bancario automático. Procede a la aprobación o rechazo manual.</i>`;
          await storeConfig.bot.sendMessage(storeConfig.chatId, reminderMsg, { parse_mode: 'HTML' }).catch(console.error);
        }
      } catch(e) {
        console.error(`Error en recordatorio de 2 min para pedido #${order.id}:`, e);
      }
    }, 2 * 60 * 1000); // 2 minutos
  }
}

// ========================================
// 6.5 AUTO-APROBACIÓN POR NOTIFICACIÓN BANCARIA
// ========================================

/**
 * Auto-aprueba un pedido pendiente. Replica EXACTAMENTE la lógica del botón
 * "✅ Aprobar" del callback_query handler, incluyendo:
 *   - Despacho de API (processApiTopupFromTelegram) si tiene apiProvider
 *   - VIP rewards y cashback
 *   - Wallet recharge y referidos
 *   - Notificación al usuario
 *   - Actualización de botones de Telegram
 *   - Polling si la API queda en "processing"
 *
 * @param {string} orderId    - ID del pedido a aprobar
 * @param {string} storeName  - Nombre de la tienda (ej: 'AccessPlay')
 * @param {object} bankInfo   - Info del pago bancario { ref, amountBs, type, name, phone }
 * @returns {Promise<boolean>} true si se procesó, false si ya no era pending
 */
async function autoApproveOrder(orderId, storeName, bankInfo) {
  const appInstance = storeApps[storeName];
  const botConfig = bots[storeName];
  if (!appInstance || !botConfig) return false;

  const dbRef = appInstance.database().ref('orders/' + orderId);
  const snap = await dbRef.once('value');
  const orderData = snap.val();

  if (!orderData || orderData.status !== 'pending') {
    console.log(`[${storeName}] ⚠️ autoApproveOrder: Pedido #${orderId} ya no es pending (${orderData?.status}). Saltando.`);
    return false;
  }

  // No auto-aprobar pagos de billetera (esos ya tienen su flujo propio)
  if (orderData.paymentMethodId === 'wallet' || orderData.paymentMethodId === 'pin-redemption') {
    console.log(`[${storeName}] ⚠️ autoApproveOrder: Pedido #${orderId} es de billetera/PIN. Saltando.`);
    return false;
  }

  console.log(`[${storeName}] 🤖🏦 AUTO-APROBANDO pedido #${orderId} (Ref banco: ${bankInfo.ref}, Bs.${bankInfo.amountBs})`);

  let newStatus = 'completed';
  let buttonText = '✅ AUTO-APROBADO (Banco)';
  let adminNote = `Aprobado automáticamente por pago bancario (Ref: ${bankInfo.ref})`;

  // ── Despacho de API (igual que el botón Aprobar) ──
  const hasApi = orderData.apiProvider !== undefined && orderData.apiProvider !== null && orderData.apiProvider !== '';
  if (hasApi) {
    // Actualizar Telegram con botón de "procesando" si tiene mensaje
    if (orderData.telegramMessageId) {
      try {
        await botConfig.bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '⏳ Auto-procesando (Banco)...', callback_data: 'noop' }], [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]] },
          { chat_id: botConfig.chatId, message_id: orderData.telegramMessageId }
        );
      } catch(e) {}
    }

    console.log(`[${storeName}] 🤖 Pedido #${orderId} tiene API configurada. Disparando recarga...`);
    try {
      const apiRes = await processApiTopupFromTelegram(orderData, appInstance);
      console.log(`[${storeName}] 🤖 Respuesta API para #${orderId}:`, apiRes);
      newStatus = apiRes.status;
      buttonText = apiRes.msg;
      adminNote = apiRes.dbNote || adminNote;
    } catch(e) {
      console.error(`[${storeName}] Error en API desde autoApproveOrder:`, e);
    }
  }

  // ── Actualizar estado en Firebase ──
  const statusHistory = orderData.statusHistory || [];
  statusHistory.push({ status: newStatus, timestamp: new Date().toISOString(), note: adminNote });

  await dbRef.update({
    status: newStatus,
    adminNote,
    updatedAt: new Date().toISOString(),
    statusHistory
  });

  // ── Actualizar botones de Telegram ──
  if (orderData.telegramMessageId) {
    const finalMarkup = {
      inline_keyboard: [
        [{ text: buttonText, callback_data: 'noop' }],
        [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
      ]
    };
    try {
      await botConfig.bot.editMessageReplyMarkup(finalMarkup, { chat_id: botConfig.chatId, message_id: orderData.telegramMessageId });
    } catch(e) { console.error(`[${storeName}] Error actualizando markup en autoApprove:`, e.message); }
  }

  // ── Aplicar VIP, cashback, referidos, notificaciones ──
  if (newStatus === 'completed') {
    await applyVipRewards(orderData, appInstance, storeName);
    await applyWalletAndReferralRewards(orderData, appInstance, storeName);

    try {
      if (orderData.userId) {
        await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
          title: orderData.productType === 'wallet-recharge' ? 'Recarga Exitosa 💵' : 'Pedido Completado ✅',
          body: orderData.productType === 'wallet-recharge'
            ? `Tu recarga de monedero por $${parseFloat(orderData.priceUsd||0).toFixed(2)} ha sido procesada con éxito.`
            : `Tu pedido de ${orderData.productName} ha sido procesado con éxito.${adminNote ? ` Nota: ${adminNote}` : ''}`,
          type: orderData.productType === 'wallet-recharge' ? 'wallet' : 'order',
          timestamp: new Date().toISOString(),
          read: false
        });
      }
    } catch(e) { console.error('Error enviando notificación en autoApprove:', e); }

    // Entrega de códigos
    if (adminNote && (adminNote.includes('Código entregado') || adminNote.includes('Códigos entregados'))) {
      const codeMsg = `🤖 <b>ENTREGA AUTOMÁTICA — #${orderId}</b>\n\n${adminNote}`;
      await botConfig.bot.sendMessage(botConfig.chatId, codeMsg, { parse_mode: 'HTML' }).catch(console.error);
    }
  }

  if (newStatus === 'rejected') {
    try {
      if (orderData.userId) {
        await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
          title: 'Pedido Rechazado ❌',
          body: `Tu pedido de ${orderData.productName || 'producto'} ha sido rechazado. Nota: ${adminNote || 'Rechazado por API'}`,
          type: 'order',
          timestamp: new Date().toISOString(),
          read: false
        });
      }
    } catch (e) { console.error('Error enviando notificación de rechazo en autoApprove:', e); }
  }

  if (newStatus === 'processing') {
    try {
      if (orderData.userId) {
        await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
          title: 'Pedido en Proceso ⚙️',
          body: `Tu pedido de ${orderData.productName || 'producto'} ahora está: PROCESANDO ⚙️.`,
          type: 'order',
          timestamp: new Date().toISOString(),
          read: false
        });
      }
    } catch (e) { console.error('Error enviando notificación de proceso en autoApprove:', e); }

    // Iniciar polling para verificar cuando la API termine
    pollApiStatus(orderId, orderData, appInstance, storeName, botConfig.chatId, orderData.telegramMessageId || null);
  }

  // ── Mensaje de confirmación al admin en Telegram ──
  const typeLabel = bankInfo.type === 'pagomovil' ? 'Pago Móvil' : bankInfo.type === 'transferencia_bdv' ? 'Transferencia BDV' : 'Transferencia Otros Bancos';
  const confirmMsg = `🤖🏦 <b>PEDIDO AUTO-APROBADO — #${orderId}</b>\n\n` +
    `✅ Estado: <b>${newStatus.toUpperCase()}</b>\n` +
    `🔢 Ref Banco: <code>${bankInfo.ref}</code>\n` +
    `💰 Monto Banco: Bs. ${bankInfo.amountBs.toFixed(2)}\n` +
    `🏦 Tipo: ${typeLabel}\n` +
    (bankInfo.name ? `👤 Pagador: ${bankInfo.name}\n` : '') +
    (bankInfo.phone ? `📱 Tel: ${bankInfo.phone}\n` : '') +
    `📝 Nota: ${adminNote}`;

  await botConfig.bot.sendMessage(botConfig.chatId, confirmMsg, { parse_mode: 'HTML' }).catch(console.error);

  console.log(`✅ [${storeName}] Pedido #${orderId} AUTO-APROBADO por banco. Status: ${newStatus}`);
  return true;
}

// ========================================
// 7. INICIAR LA ESCUCHA (LISTENERS)
// ========================================

const notifiedRectifications = new Set();

async function handleRectificationNotification(order, storeName, appInstance) {
   if (!order || !order.botProcessed) return;

   // Verificar si el pedido ha sido rectificado revisando el historial
   const isRectified = (order.statusHistory || []).some(h => h.note && h.note.toLowerCase().includes('rectificó'));
   if (!isRectified) return;

   // Solo notificar si llegó a un estado final tras la rectificación
   if (order.status === 'completed' || order.status === 'invalid-id') {
      const cacheKey = `${order.id}_${order.status}_${(order.statusHistory || []).length}`;
      if (notifiedRectifications.has(cacheKey)) return;
      notifiedRectifications.add(cacheKey);

      const storeConfig = bots[storeName];
      let msg = '';
      if (order.status === 'completed') {
         msg = `🚀 <b>PEDIDO AUTO-COMPLETADO (Rectificado) — #${order.id}</b>\n`;
         msg += `El cliente corrigió su ID a <code>${order.gameId}</code> y la recarga se procesó con éxito.\n`;
         msg += `📝 <b>Nota:</b> ${order.adminNote || 'Entregado'}`;
      } else if (order.status === 'invalid-id') {
         msg = `⚠️ <b>DATOS INVÁLIDOS DE NUEVO — #${order.id}</b>\n`;
         msg += `El cliente intentó corregir el ID a <code>${order.gameId}</code> pero la API lo rechazó otra vez.\n`;
         msg += `📝 <b>Error:</b> ${order.adminNote || 'ID Inválido'}`;
      }

      const options = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]]
        }
      };

      try {
         await storeConfig.bot.sendMessage(storeConfig.chatId, msg, options);
         console.log(`✅ [${storeName}] Notificación de rectificación enviada para #${order.id}`);
      } catch (e) {
         console.error(`❌ [${storeName}] Error enviando rectificación a Telegram:`, e.message);
      }
   }
}

async function syncTelegramStatus(orderId, order, storeName) {
  if (!order || !order.telegramMessageId || !order.botProcessed) return;

  const storeConfig = bots[storeName];
  if (!storeConfig || !storeConfig.bot || !storeConfig.chatId) return;

  let inline_keyboard = [];
  if (order.status !== 'pending') {
    let stateText = '✅ COMPLETADO';
    if (order.status === 'processing') stateText = '⏳ PROCESANDO...';
    else if (order.status === 'rejected') {
      stateText = order.rejectReason ? `❌ RECHAZADO: ${order.rejectReason}` : '❌ RECHAZADO';
    }
    else if (order.status === 'invalid-id') stateText = '❌ ID INVÁLIDO';
    
    if (order.status === 'completed' && order.paymentMethodId === 'wallet') {
      stateText = '✅ Pagado con Monedero (Automático)';
    }

    inline_keyboard = [
       [{ text: stateText, callback_data: 'ignore' }],
       [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
    ];
  } else {
    if (order.paymentMethodId === 'wallet') {
      inline_keyboard = [
         [{ text: '⏳ Auto-Procesando...', callback_data: 'ignore' }],
         [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
      ];
    } else {
      inline_keyboard = [
         [
           { text: '✅ Aprobar', callback_data: `approve_${orderId}` },
           { text: '❌ Rechazar', callback_data: `reject_${orderId}` }
         ],
         [{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]
      ];
    }
  }

  try {
    await storeConfig.bot.editMessageReplyMarkup(
      { inline_keyboard }, 
      { chat_id: storeConfig.chatId, message_id: order.telegramMessageId }
    );
  } catch (e) {
    if (!e.message.includes('is not modified') && !e.message.includes('exactly the same')) {
      console.error(`❌ [${storeName}] Error sincronizando botones Telegram para #${orderId}:`, e.message);
    }
  }
}

async function processNewWithdrawal(withdrawalId, withdrawal, appInstance, storeName) {
  if (withdrawal.botProcessed) return;

  const storeConfig = bots[storeName];
  if (!storeConfig) return;

  const dbRef = appInstance.database().ref('withdrawals/' + withdrawalId);

  // 1. Marcar como procesado por el bot
  await dbRef.update({ botProcessed: true });

  // 2. Construir mensaje
  let typeStr = (withdrawal.type === 'tournament' || withdrawal.type === 'tournament_prize') ? '🏆 RETIRO DE TORNEO' : '🎁 RETIRO DE TIENDA (PTS)';
  let msg = `💰 <b>NUEVA SOLICITUD DE RETIRO</b>\n\n`;
  msg += `<b>Tipo:</b> ${typeStr}\n`;
  msg += `👤 <b>Usuario:</b> <code>${withdrawal.userName || 'N/A'}</code>\n`;
  msg += `📧 <b>Email:</b> ${withdrawal.userEmail || 'N/A'}\n\n`;
  
  msg += `💵 <b>MONTO A PAGAR:</b>\n`;
  if (withdrawal.type !== 'tournament' && withdrawal.type !== 'tournament_prize') {
    msg += `• Puntos descontados: ${withdrawal.amountPoints || 0} PTS\n`;
  }
  msg += `• A enviar: <b>$${parseFloat(withdrawal.amountUsd || 0).toFixed(2)} USD</b>`;
  if (withdrawal.amountBs) {
    msg += ` | <b>Bs. ${parseFloat(withdrawal.amountBs).toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</b>`;
  }
  msg += `\n\n`;
  
  msg += `🏦 <b>DATOS DE PAGO:</b>\n`;
  if (withdrawal.method === 'binance') {
    msg += `• Método: Binance Pay\n`;
    msg += `• Correo / Pay ID: <code>${withdrawal.details?.account || ''}</code>\n`;
  } else if (withdrawal.method === 'pagomovil') {
    msg += `• Método: Pago Móvil\n`;
    msg += `• Banco: ${withdrawal.details?.bank || ''}\n`;
    msg += `• Teléfono: <code>${withdrawal.details?.phone || ''}</code>\n`;
    msg += `• Cédula: <code>${withdrawal.details?.cedula || ''}</code>\n`;
  } else {
    msg += `• Método: ${withdrawal.method}\n`;
  }

  const inline_keyboard = [
    [
      { text: '✅ Aprobar', callback_data: `approve_w_${withdrawalId}` },
      { text: '❌ Rechazar', callback_data: `reject_w_${withdrawalId}` }
    ]
  ];

  try {
    const sentMsg = await storeConfig.bot.sendMessage(storeConfig.chatId, msg, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
    
    // Guardar el ID del mensaje para poder actualizar los botones después
    await dbRef.update({ telegramMessageId: sentMsg.message_id });
    console.log(`✅ [${storeName}] Mensaje de retiro #${withdrawalId} enviado a Telegram.`);
  } catch (err) {
    console.error(`❌ [${storeName}] Error enviando mensaje de retiro a Telegram:`, err);
  }
}

async function processNewInscription(tournamentId, userId, pData, tData, appInstance, storeName) {
  if (pData.botProcessed) return;

  const storeConfig = bots[storeName];
  if (!storeConfig) return;

  const dbRef = appInstance.database().ref(`tournament_participants/${tournamentId}/${userId}`);

  // 1. Marcar como procesado
  await dbRef.update({ botProcessed: true });

  // Get exchange rate for Bs calculation
  let bsAmountStr = '';
  if (tData.entryFee) {
    try {
      const snap = await appInstance.database().ref('exchange_rate').once('value');
      const rates = snap.val() || {};
      const rate = rates.tournamentsUsdToBs || rates.usdToBs || 1;
      bsAmountStr = ` | Bs. ${(tData.entryFee * rate).toFixed(2)}`;
    } catch (e) { }
  }

  // Format mode
  const modeLabels = { solo: 'Solo', duo: 'Dúo', squad: 'Escuadra' };
  const modeText = modeLabels[tData.gameMode] || tData.gameMode || 'Solo';

  // Format Team members
  let membersText = '';
  if (pData.teamMembers && Object.keys(pData.teamMembers).length > 0) {
    membersText = Object.values(pData.teamMembers).map(tm => tm.gameName).join(', ');
  }

  // Get payment methods to map ID to Name
  let paymentMethodName = pData.paymentMethodName || pData.paymentMethod || 'N/A';
  if (pData.paymentMethod && pData.paymentMethod.startsWith('pm-')) {
    try {
      const pmSnap = await appInstance.database().ref('payment_methods').once('value');
      const pmData = pmSnap.val() || [];
      const pmItem = pmData.find(pm => pm && pm.id === pData.paymentMethod);
      if (pmItem && pmItem.name) {
        paymentMethodName = pmItem.name;
      }
    } catch (e) { }
  } else if (pData.paymentMethod === 'wallet') {
    paymentMethodName = 'Mi Billetera Virtual';
  } else if (pData.paymentMethod === 'pagomovil') {
    paymentMethodName = 'Pago Móvil / Transferencia';
  } else if (pData.paymentMethod === 'none') {
    paymentMethodName = 'Gratis';
  }

  // Check for duplicate references
  let duplicateOrders = [];
  if (pData.paymentRef) {
    const refToCheck = String(pData.paymentRef).trim();
    if (refToCheck) {
      try {
        // Check recent store orders
        const snap = await appInstance.database().ref('orders').orderByChild('createdAt').limitToLast(250).once('value');
        const allOrders = snap.val() || {};
        for (const [key, oldOrder] of Object.entries(allOrders)) {
          if (oldOrder.status !== 'rejected') {
            if (oldOrder.ocrNumbers && oldOrder.ocrNumbers.includes(refToCheck)) {
              if (!duplicateOrders.includes(`Pedido #${key}`)) duplicateOrders.push(`Pedido #${key}`);
            } else if (String(oldOrder.manualRef).trim() === refToCheck || String(oldOrder.paymentRef).trim() === refToCheck) {
              if (!duplicateOrders.includes(`Pedido #${key}`)) duplicateOrders.push(`Pedido #${key}`);
            }
          }
        }
      } catch(e) {}

      try {
        // Check participants in the same tournament
        const snap = await appInstance.database().ref(`tournament_participants/${tournamentId}`).once('value');
        const participants = snap.val() || {};
        for (const [uId, part] of Object.entries(participants)) {
          if (uId !== userId && part.paymentStatus !== 'rejected' && String(part.paymentRef).trim() === refToCheck) {
            duplicateOrders.push(`Inscripción de ${part.gameName || uId}`);
          }
        }
      } catch(e) {}
    }
  }

  // 2. Construir mensaje
  let msg = `🏆 <b>NUEVA INSCRIPCIÓN PENDIENTE</b> (${modeText})\n\n`;
  msg += `<b>Juego:</b> ${tData.productName || tData.title || 'N/A'}\n`;
  msg += `👤 <b>Jugador:</b> <code>${pData.gameName || 'N/A'}</code>\n`;
  
  if (membersText) {
    msg += `👤 <b>Miembros:</b> ${membersText}\n`;
  }

  const fee = tData.entryFee ? `$${tData.entryFee.toFixed(2)} USD${bsAmountStr}` : 'Gratis';
  msg += `💰 <b>Monto:</b> ${fee}\n`;
  msg += `🏦 <b>Método:</b> ${paymentMethodName}\n`;
  if (pData.paymentRef) msg += `🔢 <b>Referencia:</b> <code>${pData.paymentRef}</code>\n`;

  if (duplicateOrders.length > 0) {
    msg += `🚨 <b>¡ALERTA DE FRAUDE!</b> Esta referencia ya fue usada en: <b>${duplicateOrders.join(', ')}</b>\n`;
  }

  msg += `📱 <b>Contacto:</b> ${pData.email || 'N/A'}\n`;

  const actionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  await appInstance.database().ref(`botActions/${actionId}`).set({
    tournamentId: tournamentId,
    userId: userId,
    createdAt: Date.now()
  });

  const inline_keyboard = [
    [
      { text: '✅ Aprobar', callback_data: `ai_${actionId}` },
      { text: '❌ Rechazar', callback_data: `ri_${actionId}` }
    ]
  ];

  try {
    const sentMsg = await storeConfig.bot.sendMessage(storeConfig.chatId, msg, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
    
    await dbRef.update({ telegramMessageId: sentMsg.message_id });
  } catch (err) {
    console.error(`❌ [${storeName}] Error enviando msj inscripción a Telegram:`, err);
  }
}

function startListening() {
  const stores = [
    { name: 'CandyStore', app: candyStoreApp },
    { name: 'RecargaShark', app: recargaSharkApp },
    { name: 'AccessPlay', app: accessPlayApp }
  ];

  stores.forEach(store => {
    if (store.name === 'AccessPlay') {
      const wRef = store.app.database().ref('withdrawals');
      wRef.on('child_added', (snapshot) => {
        const wData = snapshot.val();
        if (wData && wData.status === 'pending') {
          processNewWithdrawal(snapshot.key, wData, store.app, store.name).catch(console.error);
        }
      });

      const tpRef = store.app.database().ref('tournament_participants');
      
      const handleTournamentParticipants = (tournamentSnap) => {
        const tId = tournamentSnap.key;
        const participants = tournamentSnap.val() || {};
        
        Object.keys(participants).forEach(uid => {
          const p = participants[uid];
          if (p.paymentStatus === 'pending_payment' && !p.botProcessed) {
            // Fetch tournament data for context
            store.app.database().ref('tournaments/' + tId).once('value').then(tSnap => {
              const tData = tSnap.val();
              if (tData) {
                processNewInscription(tId, uid, p, tData, store.app, store.name).catch(console.error);
              }
            }).catch(console.error);
          }
        });
      };

      tpRef.on('child_added', handleTournamentParticipants);
      tpRef.on('child_changed', handleTournamentParticipants);

      // Recalcular contadores automáticamente (Mantiene sincronizado 0/48)
      tpRef.on('value', (snap) => {
        const allParticipants = snap.val() || {};
        store.app.database().ref('tournaments').once('value').then(tSnap => {
          const tournaments = tSnap.val() || {};
          const updates = {};
          let globalCount = 0;
          
          Object.keys(tournaments).forEach(tId => {
            const participants = allParticipants[tId] || {};
            let count = 0;
            Object.values(participants).forEach(p => {
              // Excluimos fantasmas/rechazados
              if (p.paymentStatus === 'approved' || p.paymentStatus === 'free') {
                const extraMembers = p.teamMembers ? Object.values(p.teamMembers).filter(tm => tm.gameId !== p.gameId).length : 0;
                const adds = 1 + extraMembers;
                count += adds;
                globalCount += adds;
              }
            });
            if (tournaments[tId].participantsCount !== count) {
              updates[`tournaments/${tId}/participantsCount`] = count;
            }
          });
          
          updates['tournament_metadata/participants'] = globalCount;
          
          if (Object.keys(updates).length > 0) {
            store.app.database().ref().update(updates).catch(console.error);
          }
        }).catch(console.error);
      });
    }

    const ref = store.app.database().ref('orders');
    
    // Escuchar nuevos pedidos añadidos
    ref.on('child_added', (snapshot) => {
      const orderData = snapshot.val();
      const orderId = snapshot.key;
      processNewOrder(orderId, store.name, store.app, 'child_added').catch(err => console.error(err));
      
      if (orderData && orderData.status === 'processing') {
          pollApiStatus(orderId, orderData, store.app, store.name).catch(console.error);
      }
    });

    // También escuchar por si el frontend añade la imagen después o si se rectifica
    ref.on('child_changed', async (snapshot) => {
      const orderData = snapshot.val();
      const orderId = snapshot.key;

      // DETECCIÓN DE RECTIFICACIÓN
      if (orderData && orderData.status === 'pending') {
         const rawHistory = orderData.statusHistory || [];
         const history = Array.isArray(rawHistory) ? rawHistory : Object.values(rawHistory);
         const lastHistory = history[history.length - 1];
         // Si el último evento fue una rectificación
         if (lastHistory && lastHistory.note && lastHistory.note.toLowerCase().includes('rectificó')) {
             console.log(`🔄 [${store.name}] Rectificación detectada para #${orderId}. Re-intentando API...`);
             try {
                 const apiRes = await processApiTopupFromTelegram(orderData, store.app);
                 orderData.status = apiRes.status;
                 orderData.adminNote = apiRes.dbNote;
                 
                 const newHistory = [...history, {
                     status: apiRes.status,
                     timestamp: new Date().toISOString(),
                     note: apiRes.dbNote
                 }];
                 
                 await ref.child(orderId).update({
                     status: apiRes.status,
                     adminNote: apiRes.dbNote,
                     updatedAt: new Date().toISOString(),
                     statusHistory: newHistory
                 });
                 // Actualizamos telegram
                 await syncTelegramStatus(orderId, orderData, store.name);
                 return; // Evitar que el resto del child_changed procese si acabamos de actualizar
             } catch (e) {
                 console.error('❌ Error re-procesando rectificación:', e);
             }
         }
      }

      handleRectificationNotification(orderData, store.name, store.app).catch(err => console.error(err));
      processNewOrder(orderId, store.name, store.app, 'child_changed').catch(err => console.error(err));
      syncTelegramStatus(orderId, orderData, store.name).catch(err => console.error(err));
      
      if (orderData && orderData.status === 'processing') {
          pollApiStatus(orderId, orderData, store.app, store.name).catch(console.error);
      }
    });

    // =====================================
    // LISTENER PARA MENSAJES DE SOPORTE
    // =====================================
    const messagesRef = store.app.database().ref('messages');
    
    const handleSupportMessage = async (snapshot) => {
      const convData = snapshot.val();
      const sessionId = snapshot.key;
      
      if (!convData || !convData.messages || !Array.isArray(convData.messages)) return;
      
      const lastMsgIndex = convData.messages.length - 1;
      const lastMsg = convData.messages[lastMsgIndex];
      
      if (lastMsg && lastMsg.sender === 'user' && !lastMsg.telegramSent) {
         try {
           // Marcar como enviado en Firebase inmediatamente
           await messagesRef.child(sessionId).child('messages').child(lastMsgIndex.toString()).update({ telegramSent: true });
           
           const storeConfig = bots[store.name];
           if (storeConfig && storeConfig.bot && storeConfig.chatId) {
             const escapeHtml = (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
             const contactInfo = convData.contact || 'Desconocido';
             
             const tgMsg = `💬 <b>Nuevo Mensaje de Soporte</b>\n\n<b>Contacto:</b> ${escapeHtml(contactInfo)}\n<b>Mensaje:</b> ${escapeHtml(lastMsg.text)}\n\n<i>Responde desde el Panel Admin</i>`;
             
             await storeConfig.bot.sendMessage(storeConfig.chatId, tgMsg, {
               parse_mode: 'HTML',
               reply_markup: {
                 inline_keyboard: [[{ text: '🔍 Abrir Panel Admin', url: storeConfig.adminUrl }]]
               }
             });
             console.log(`💬✅ [${store.name}] Notificación de soporte enviada a Telegram.`);
           }
         } catch (e) {
           console.error(`❌ [${store.name}] Error enviando msj de soporte:`, e.message);
         }
      }
    };

    messagesRef.on('child_added', handleSupportMessage);
    messagesRef.on('child_changed', handleSupportMessage);

    console.log(`👂 Escuchando pedidos y mensajes en tiempo real: ${store.name}`);
  });

  console.log('🚀 CEREBRO CENTRAL EN LÍNEA Y ESPERANDO PEDIDOS...');

  // ========================================
  // 7.5 LISTENER DE NOTIFICACIONES BANCARIAS (Solo AccessPlay)
  // ========================================
  const bankNotifRef = accessPlayApp.database().ref('bank_notifications');
  const bankVaultRef = accessPlayApp.database().ref('bank_vault');
  const accessPlayBotConfig = bots['AccessPlay'];

  bankNotifRef.on('child_added', async (snapshot) => {
    const notifData = snapshot.val();
    const notifId = snapshot.key;

    // Ignorar notificaciones ya procesadas o viejas (más de 5 minutos al arrancar)
    if (!notifData || notifData.processed) return;
    if (notifData.receivedAt && (Date.now() - notifData.receivedAt) > 5 * 60 * 1000) {
      // Marcar como procesada silenciosamente para no reprocesar al reiniciar
      await bankNotifRef.child(notifId).update({ processed: true }).catch(() => {});
      return;
    }

    // Marcar como procesada inmediatamente para evitar doble procesamiento
    await bankNotifRef.child(notifId).update({ processed: true });

    console.log(`\n🏦 [AccessPlay] Nueva notificación bancaria recibida: ${notifId}`);

    // ── Parsear la notificación ──
    const parsed = parseBankNotification(notifData.title, notifData.text);
    if (!parsed) {
      console.log(`⚠️ [AccessPlay] No se pudo parsear la notificación bancaria. Texto: "${notifData.text}"`);
      // Notificar al admin que llegó algo pero no se reconoció el formato
      const unknownMsg = `⚠️ <b>NOTIFICACIÓN BANCARIA NO RECONOCIDA</b>\n\n` +
        `📝 Título: ${notifData.title || 'N/A'}\n` +
        `📝 Texto: ${notifData.text || 'N/A'}\n\n` +
        `<i>El formato no coincide con PagoMóvil, Transferencia BDV ni Transferencia de otros bancos.</i>`;
      await accessPlayBotConfig.bot.sendMessage(accessPlayBotConfig.chatId, unknownMsg, { parse_mode: 'HTML' }).catch(console.error);
      return;
    }

    console.log(`🏦 [AccessPlay] Pago parseado: Ref=${parsed.ref} Monto=Bs.${parsed.amountBs} Tipo=${parsed.type}`);

    // ── Verificar si la referencia ya fue usada (anti-duplicados) ──
    try {
      const vaultSnap = await bankVaultRef.orderByChild('ref').equalTo(parsed.ref).once('value');
      const vaultEntries = vaultSnap.val();
      if (vaultEntries) {
        const alreadyUsed = Object.values(vaultEntries).some(v => v.used === true);
        if (alreadyUsed) {
          console.log(`🚨 [AccessPlay] Ref ${parsed.ref} ya fue usada. Ignorando pago duplicado.`);
          const dupMsg = `🚨 <b>PAGO BANCARIO DUPLICADO DETECTADO</b>\n\n` +
            `🔢 Ref: <code>${parsed.ref}</code>\n` +
            `💰 Monto: Bs. ${parsed.amountBs.toFixed(2)}\n\n` +
            `<i>Esta referencia ya fue usada para aprobar un pedido anterior. Ignorando.</i>`;
          await accessPlayBotConfig.bot.sendMessage(accessPlayBotConfig.chatId, dupMsg, { parse_mode: 'HTML' }).catch(console.error);
          return;
        }
      }
    } catch(e) { console.error('Error verificando vault duplicados:', e); }

    // ── Buscar pedido pendiente que coincida ──
    let matchedOrderId = null;
    try {
      const ordersSnap = await accessPlayApp.database().ref('orders').orderByChild('status').equalTo('pending').once('value');
      const pendingOrders = ordersSnap.val() || {};

      for (const [orderId, order] of Object.entries(pendingOrders)) {
        // Excluir pagos de billetera/PIN
        if (order.paymentMethodId === 'wallet' || order.paymentMethodId === 'pin-redemption') continue;

        // Buscar si la referencia bancaria coincide con alguna ref del pedido
        const orderRefs = [];
        if (Array.isArray(order.ocrNumbers)) orderRefs.push(...order.ocrNumbers.map(r => String(r).trim()));
        if (order.manualRef) orderRefs.push(String(order.manualRef).trim());

        const refMatches = orderRefs.some(r => r === parsed.ref);
        if (!refMatches) continue;

        // Verificar monto: pagó al menos el 99% del precio (pagar de más siempre es OK)
        if (order.priceBs) {
          const expectedBs = parseFloat(order.priceBs);
          const minAcceptable = expectedBs * 0.99; // 1% menos permitido
          if (parsed.amountBs < minAcceptable) {
            console.log(`⚠️ [AccessPlay] Ref ${parsed.ref} coincide con #${orderId} pero monto insuficiente: Banco=Bs.${parsed.amountBs} vs Mínimo=Bs.${minAcceptable.toFixed(2)}`);
            continue;
          }
        }

        matchedOrderId = orderId;
        break;
      }
    } catch(e) {
      console.error('Error buscando órdenes pendientes para banco:', e);
    }

    // ── Si encontramos match: AUTO-APROBAR ──
    if (matchedOrderId) {
      console.log(`✅ [AccessPlay] Match encontrado: Ref ${parsed.ref} → Pedido #${matchedOrderId}`);

      // Guardar en vault como "usada"
      await bankVaultRef.push({
        ref: parsed.ref,
        amountBs: parsed.amountBs,
        type: parsed.type,
        name: parsed.name || null,
        phone: parsed.phone || null,
        matchedOrder: matchedOrderId,
        used: true,
        timestamp: Date.now()
      }).catch(console.error);

      // Auto-aprobar
      try {
        await autoApproveOrder(matchedOrderId, 'AccessPlay', parsed);
      } catch(e) {
        console.error(`❌ [AccessPlay] Error en autoApproveOrder para #${matchedOrderId}:`, e);
      }
      return;
    }

    // ── Sin match: guardar como pago adelantado silenciosamente ──
    console.log(`⚠️ [AccessPlay] Sin match para Ref ${parsed.ref}. Guardando en bank_vault silenciosamente.`);

    await bankVaultRef.push({
      ref: parsed.ref,
      amountBs: parsed.amountBs,
      type: parsed.type,
      name: parsed.name || null,
      phone: parsed.phone || null,
      matchedOrder: null,
      used: false,
      timestamp: Date.now()
    });
  });

  console.log('🏦 Escuchando notificaciones bancarias para AccessPlay...');
}

// ========================================
// 8. ESCUCHAR BOTONES DE TELEGRAM (CALLBACKS)
// ========================================
const storeApps = { CandyStore: candyStoreApp, RecargaShark: recargaSharkApp, AccessPlay: accessPlayApp };
const telegramLocks = new Set(); // Candado anti doble-clic en Telegram

Object.keys(bots).forEach(storeName => {
  const botConfig = bots[storeName];
  botConfig.bot.on('message', async (msg) => {
    // --- LÓGICA DE RECHAZO PERSONALIZADO (ForceReply) ---
    if (msg.reply_to_message && msg.reply_to_message.text && msg.text) {
      const match = msg.reply_to_message.text.match(/Escribe el motivo del rechazo para el pedido #([A-Za-z0-9-]+):/);
      if (match) {
        const orderId = match[1];
        const customReason = msg.text.trim();
        const appInstance = storeApps[storeName];
        try {
            const dbRef = appInstance.database().ref('orders/' + orderId);
            const snap = await dbRef.once('value');
            const orderData = snap.val();

            if (!orderData || orderData.status !== 'pending') {
              botConfig.bot.sendMessage(msg.chat.id, `⚠️ El pedido #${orderId} ya fue procesado o no existe.`);
              return;
            }

            const statusHistory = orderData.statusHistory || [];
            statusHistory.push({ status: 'rejected', timestamp: new Date().toISOString(), note: customReason });

            // Reembolso si pagó con monedero
            if (orderData.paymentMethodId === 'wallet' && orderData.userId && orderData.productType !== 'wallet-recharge') {
              try {
                const walletRef = appInstance.database().ref('users/' + orderData.userId + '/wallet');
                const walletSnap = await walletRef.once('value');
                const amountToRefund = parseFloat(orderData.priceUsd || 0);
                await walletRef.set((parseFloat(walletSnap.val() || 0)) + amountToRefund);
                await appInstance.database().ref('users/' + orderData.userId + '/transactions').push({
                  id: Date.now().toString(), type: 'deposit', amount: amountToRefund,
                  description: `Pago reembolsado por pedido rechazado (#${orderData.id})`, date: Date.now()
                });
                console.log(`💸 Reembolso de $${amountToRefund} aplicado a ${orderData.userId}`);
              } catch(e) { console.error('Error reembolsando monedero (custom reject):', e); }
            }

            await dbRef.update({
              status: 'rejected', adminNote: customReason, rejectReason: customReason,
              updatedAt: new Date().toISOString(), statusHistory
            });
            
            botConfig.bot.sendMessage(msg.chat.id, `✅ Pedido #${orderId} rechazado con motivo personalizado.`);
            
            if (orderData.telegramMessageId) {
                const newMarkup = {
                    inline_keyboard: [
                        [{ text: `❌ RECHAZADO: ${customReason.substring(0, 20)}${customReason.length > 20 ? '...' : ''}`, callback_data: 'noop' }],
                        [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
                    ]
                };
                botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: msg.chat.id, message_id: orderData.telegramMessageId }).catch(()=>{});
            }
        } catch(e) {
            console.error(`[${storeName}] Error procesando rechazo personalizado:`, e);
        }
        return;
      }
    }

    if (msg.text && msg.text === '/reparar_referidos') {
      const chatId = msg.chat.id;
      if (chatId.toString() !== botConfig.chatId.toString()) return; // Solo admin
      
      const db = storeApps[storeName].database();
      botConfig.bot.sendMessage(chatId, "🔍 Iniciando escaneo de referidos atrasados...");

      try {
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
                  description: `Bono referido atrasado (${user.name || user.email || 'Amigo'} / Reintegro Comando): +12 PTS`,
                  date: Date.now()
                });
                await db.ref('users/' + uid).update({ hasMadeFirstPurchase: true });
                recompensasEntregadas++;
                botConfig.bot.sendMessage(chatId, `✅ Reintegro: +12 PTS a código ${user.referredBy} por invitar a ${user.email}`);
              } else {
                await db.ref('users/' + uid).update({ referredBy: null, hasMadeFirstPurchase: true });
              }
            }
          }
        }
        
        botConfig.bot.sendMessage(chatId, `🎉 ¡Terminado! Se entregaron ${recompensasEntregadas} bonos de referidos atrasados.`);
      } catch (e) {
        botConfig.bot.sendMessage(chatId, `❌ Error en reparación: ${e.message}`);
      }
    }

    if (msg.text && msg.text === '/reparar_gastos') {
      const chatId = msg.chat.id;
      if (chatId.toString() !== botConfig.chatId.toString()) return; // Solo admin
      
      const db = storeApps[storeName].database();
      botConfig.bot.sendMessage(chatId, "🔍 Calculando y reparando gastos de revendedores...");

      try {
        const [ordersSnap, usersSnap] = await Promise.all([
          db.ref('orders').once('value'),
          db.ref('users').once('value')
        ]);
        
        const orders = ordersSnap.val() || {};
        const users = usersSnap.val() || {};
        
        const spentMap = {};
        Object.values(orders).forEach(o => {
          if ((o.status === 'completed' || o.status === 'completado' || o.status === 'old') && o.productType !== 'wallet-recharge') {
            spentMap[o.userId] = (spentMap[o.userId] || 0) + (Number(o.priceUsd) || 0);
          }
        });
        
        const updates = {};
        let count = 0;
        for (const uid in users) {
          if (users[uid].role === 'revendedor' && spentMap[uid] && users[uid].totalSpent !== spentMap[uid]) {
            updates[uid + '/totalSpent'] = spentMap[uid];
            count++;
          }
        }
        
        if (count > 0) {
          await db.ref('users').update(updates);
          botConfig.bot.sendMessage(chatId, `🎉 ¡Listo! Se corrigieron los gastos de ${count} revendedores de forma segura, sin tocar puntos ni cashback de los demás clientes.`);
        } else {
          botConfig.bot.sendMessage(chatId, `ℹ️ Todos los revendedores ya estaban corregidos o no hay nada que actualizar.`);
        }
      } catch (e) {
        botConfig.bot.sendMessage(chatId, `❌ Error en reparación de gastos: ${e.message}`);
      }
    }

    if (msg.text && (msg.text === '/reparar_torneos' || msg.text === 'reparar_torneos')) {
      const chatId = msg.chat.id;
      if (chatId.toString() !== botConfig.chatId.toString()) return; // Solo admin
      
      // Asegurarse de que solo aplique para AccessPlay
      if (storeName !== 'AccessPlay') return;
      
      const db = storeApps[storeName].database();
      botConfig.bot.sendMessage(chatId, "🛠️ Iniciando el Bot de Limpieza de Bugs de Torneos...");

      try {
        // 1. Obtener todos los torneos
        const torneosSnap = await db.ref('tournaments').once('value');
        const torneos = torneosSnap.val() || {};
        
        // 2. Obtener inscripciones reales
        const participantesSnap = await db.ref('tournament_participants').once('value');
        const participantes = participantesSnap.val() || {};
        
        let completedCount = 0;
        let activeCount = 0;
        let globalParticipants = 0;
        let updates = {};
        let logs = [];
        let erroresEncontrados = 0;
        
        for (const tId in torneos) {
            const t = torneos[tId];
            
            // Contar torneos para las estadísticas globales
            if (t.status === 'completed' || t.status === 'completado') {
                completedCount++;
            } else if (t.status === 'registration_open' || t.status === 'ongoing' || t.status === 'in_progress' || t.status === 'upcoming' || t.status === 'active') {
                activeCount++;
            }
            
            // "Que no toque los torneos que estan en curso (jugándose)"
            if (t.status === 'in_progress' || t.status === 'ongoing') {
                continue;
            }
            
            // Contar inscripciones reales evitando "fantasmas" (rechazados) y contando miembros de equipo
            const inscripciones = participantes[tId] || {};
            let realCount = 0;
            
            Object.values(inscripciones).forEach(p => {
                if (p.paymentStatus === 'approved' || p.paymentStatus === 'free') {
                    // Contamos al líder + los miembros de su equipo (evitando doble conteo del líder si está en el array)
                    const extraMembers = p.teamMembers ? Object.values(p.teamMembers).filter(tm => tm.gameId !== p.gameId).length : 0;
                    realCount += 1 + extraMembers;
                    globalParticipants += 1 + extraMembers;
                }
            });
            
            const currentCount = t.participantsCount || 0;
            
            if (realCount !== currentCount) {
                logs.push(`- Torneo ${t.name || t.title || tId}: decía ${currentCount} -> ahora ${realCount}`);
                updates[`tournaments/${tId}/participantsCount`] = realCount;
                erroresEncontrados++;
            }
        }
        
        // Actualizar estadísticas globales correctas
        const metaSnap = await db.ref('tournament_metadata').once('value');
        const meta = metaSnap.val() || {};
        
        if ((meta.completed || 0) !== completedCount) {
            logs.push(`- Torneos Finalizados: decía ${meta.completed || 0} -> ahora ${completedCount}`);
            updates[`tournament_metadata/completed`] = completedCount;
            erroresEncontrados++;
        }
        
        if ((meta.active || 0) !== activeCount) {
            logs.push(`- Torneos Activos: decía ${meta.active || 0} -> ahora ${activeCount}`);
            updates[`tournament_metadata/active`] = activeCount;
            erroresEncontrados++;
        }
        
        // Aplicar actualizaciones masivas a Firebase
        if (Object.keys(updates).length > 0) {
            await db.ref().update(updates);
            
            let finalMsg = `✅ ¡Limpieza de Bugs Exitosa!\n\nSe corrigieron ${erroresEncontrados} errores de sincronización:\n`;
            finalMsg += logs.join('\n');
            botConfig.bot.sendMessage(chatId, finalMsg);
        } else {
            botConfig.bot.sendMessage(chatId, `✅ Todo estaba sincronizado perfectamente. No había bugs de conteo.`);
        }
      } catch (e) {
        botConfig.bot.sendMessage(chatId, `❌ Error crítico en el bot: ${e.message}`);
      }
    }
  });

  botConfig.bot.on('callback_query', async (query) => {
    console.log(`[${storeName}] ➡️ Recibido callback_query:`, query.data);

    // ✅ FIX CRÍTICO: Responder a Telegram INMEDIATAMENTE para que el botón
    // no quede cargando. Hacemos todo el procesamiento DESPUÉS de esto.
    // Telegram requiere respuesta en <60s, pero con API calls y Firebase
    // podemos exceder ese límite. Responder ya elimina el spinner.
    try { await botConfig.bot.answerCallbackQuery(query.id); } catch(e) {
      console.warn(`[${storeName}] ⚠️ answerCallbackQuery inicial falló (puede ser query expirada):`, e.message);
    }

    try {
      const data = query.data || '';

      // Sin mensaje asociado (puede pasar con mensajes muy viejos)
      if (!query.message) {
        console.log(`[${storeName}] ⚠️ Callback sin mensaje asociado. Ignorado.`);
        return;
      }

      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      // Botones informativos - ya se respondió arriba, solo salir
      if (data === 'ignore' || data === 'noop') return;

      // Datos desconocidos - ignorar silenciosamente
      if (!data.startsWith('approve_') && !data.startsWith('reject_') && !data.startsWith('rejectreason_') && !data.startsWith('cancelreject_') && !data.startsWith('ai_') && !data.startsWith('ri_')) {
        console.log(`[${storeName}] ⚠️ Callback data ignorado:`, data);
        return;
      }

      // ── INSCRIPCIONES PAGAS (TOURNAMENTS) ──
      if (data.startsWith('ai_') || data.startsWith('ri_')) {
        const isApprove = data.startsWith('ai_');
        const actionId = data.replace(isApprove ? 'ai_' : 'ri_', '');
        const appInstance = storeApps[storeName];
        
        const lockId = `tinsc_${actionId}`;
        if (telegramLocks.has(lockId)) {
          try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⏳ Procesando inscripción...' }); } catch(e){}
          return;
        }
        telegramLocks.add(lockId);

        try {
          const actionRef = appInstance.database().ref(`botActions/${actionId}`);
          const actionSnap = await actionRef.once('value');
          const actionData = actionSnap.val();

          if (!actionData) {
            try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Acción expirada o inválida.', show_alert: true }); } catch(e){}
            return;
          }

          const tId = actionData.tournamentId;
          const uId = actionData.userId;

          const pRef = appInstance.database().ref(`tournament_participants/${tId}/${uId}`);
          const snap = await pRef.once('value');
          const pData = snap.val();

          console.log(`[${storeName}] Tournament data for ${tId}/${uId}:`, pData);
          if (!pData) {
            try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Inscripción no encontrada.', show_alert: true }); } catch(e){}
            return;
          }

          if (pData.paymentStatus !== 'pending' && pData.paymentStatus !== 'pending_payment') {
            console.log(`[${storeName}] ⚠️ pData is already processed. Status:`, pData.paymentStatus);
            // Update the button to reflect the current state if it was already processed externally
            const stateText = (pData.paymentStatus === 'approved' || pData.paymentStatus === 'free') ? '✅ INSCRITO' : '❌ RECHAZADO';
            const newMarkup = { inline_keyboard: [[{ text: stateText, callback_data: 'noop' }]] };
            try { await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId }); } catch(e){}
            try { await botConfig.bot.answerCallbackQuery(query.id, { text: `Inscripción ya estaba procesada.` }); } catch(e){}
            return;
          }

          if (isApprove) {
            await pRef.update({ paymentStatus: 'approved' });
            
            // Increment participantsCount in tournament
            const extraMembers = pData.teamMembers ? Object.values(pData.teamMembers).filter(tm => tm.gameId !== pData.gameId).length : 0;
            const countAddition = 1 + extraMembers;
            await appInstance.database().ref('tournaments/' + tId + '/participantsCount').transaction(c => (c || 0) + countAddition);
            await appInstance.database().ref('tournament_metadata/participants').transaction(c => (c || 0) + countAddition);
            
            if (pData.uid) {
              await appInstance.database().ref('users/' + pData.uid + '/notifications').push({
                title: 'Inscripción Aprobada ✅',
                body: `Tu pago ha sido verificado y tu cupo está asegurado en el torneo.`,
                type: 'tournament',
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          } else {
            await pRef.update({ paymentStatus: 'rejected' });
            if (pData.uid) {
              await appInstance.database().ref('users/' + pData.uid + '/notifications').push({
                title: 'Inscripción Rechazada ❌',
                body: `Hubo un problema con el pago de tu inscripción. Por favor contacta a soporte.`,
                type: 'tournament',
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          }

          const stateText = isApprove ? '✅ INSCRITO' : '❌ RECHAZADO';
          const newMarkup = { inline_keyboard: [[{ text: stateText, callback_data: 'noop' }]] };
          try { await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId }); } catch(e){}
          try { await botConfig.bot.answerCallbackQuery(query.id, { text: `Inscripción ${stateText}` }); } catch(e){}
        } catch(e) {
          console.error(`[${storeName}] Error procesando inscripción:`, e);
        } finally {
          telegramLocks.delete(lockId);
        }
        return;
      }

      // ── RETIROS (WITHDRAWALS) ──
      if (data.startsWith('approve_w_') || data.startsWith('reject_w_')) {
        const isApprove = data.startsWith('approve_w_');
        const wId = data.replace(isApprove ? 'approve_w_' : 'reject_w_', '');
        const appInstance = storeApps[storeName];

        if (telegramLocks.has(wId)) {
          try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⏳ Procesando retiro...' }); } catch(e){}
          return;
        }
        telegramLocks.add(wId);

        try {
          const wRef = appInstance.database().ref('withdrawals/' + wId);
          const snap = await wRef.once('value');
          const wData = snap.val();

          if (!wData || wData.status !== 'pending') {
            try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Retiro ya procesado.', show_alert: true }); } catch(e){}
            return;
          }

          if (isApprove) {
            await wRef.update({ status: 'completed', processedAt: Date.now() });
            
            // Notificar
            if (wData.userId) {
              await appInstance.database().ref('users/' + wData.userId + '/notifications').push({
                title: 'Retiro Aprobado ✅',
                body: `Tu solicitud de retiro de $${wData.amountUsd} USD ha sido completada y enviada a tu cuenta.`,
                type: 'withdrawal',
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          } else {
            // Rechazado (Reembolso)
            await wRef.update({ status: 'rejected', processedAt: Date.now() });
            if (wData.userId) {
              if (wData.type === 'tournament' || wData.type === 'tournament_prize') {
                const wTournRef = appInstance.database().ref('users/' + wData.userId + '/withdrawnTournamentEarnings');
                const tSnap = await wTournRef.once('value');
                await wTournRef.set(Math.max(0, (parseFloat(tSnap.val()) || 0) - (parseFloat(wData.amountUsd) || 0)));
              } else {
                const uPointsRef = appInstance.database().ref('users/' + wData.userId + '/points');
                const pSnap = await uPointsRef.once('value');
                await uPointsRef.set((parseFloat(pSnap.val()) || 0) + (parseFloat(wData.amountPoints) || 0));
                
                await appInstance.database().ref('users/' + wData.userId + '/transactions').push({
                  id: Date.now().toString(), type: 'deposit', amount: 0,
                  description: `Devolución por retiro rechazado (+${wData.amountPoints} PTS)`,
                  date: Date.now()
                });
              }

              await appInstance.database().ref('users/' + wData.userId + '/notifications').push({
                title: 'Retiro Rechazado ❌',
                body: `Tu solicitud de retiro fue rechazada. Los fondos han sido devueltos a tu saldo disponible.`,
                type: 'withdrawal',
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          }

          // Actualizar mensaje de Telegram
          const stateText = isApprove ? '✅ APROBADO' : '❌ RECHAZADO';
          const newMarkup = { inline_keyboard: [[{ text: stateText, callback_data: 'noop' }]] };
          try { await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId }); } catch(e){}

          try { await botConfig.bot.answerCallbackQuery(query.id, { text: `Retiro ${stateText}` }); } catch(e){}
        } catch(e) {
          console.error(`[${storeName}] Error procesando retiro #${wId}:`, e.message);
        } finally {
          telegramLocks.delete(wId);
        }
        return;
      }

      // ── CANCELAR RECHAZO ──
      if (data.startsWith('cancelreject_')) {
        const orderId = data.replace('cancelreject_', '');
        const newMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Aprobar', callback_data: `approve_${orderId}` },
              { text: '❌ Rechazar', callback_data: `reject_${orderId}` }
            ],
            [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
          ]
        };
        try {
          await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
        } catch(e) { console.error(`[${storeName}] Error editando markup en cancelreject:`, e.message); }
        return;
      }

      // ── MOTIVO DE RECHAZO ──
      if (data.startsWith('rejectreason_')) {
        const rest = data.substring('rejectreason_'.length);
        const lastUnderscore = rest.lastIndexOf('_');
        const orderId = rest.substring(0, lastUnderscore);
        const reasonCode = rest.substring(lastUnderscore + 1);
        const appInstance = storeApps[storeName];

        if (reasonCode === 'custom') {
           const forceReplyMarkup = {
             force_reply: true,
             input_field_placeholder: 'Escribe el motivo...'
           };
           try {
             await botConfig.bot.sendMessage(chatId, `⚠️ Escribe el motivo del rechazo para el pedido #${orderId}:\n*(Responde directamente a este mensaje)*`, { reply_markup: forceReplyMarkup, parse_mode: 'Markdown' });
           } catch(e) { console.error('Error enviando force_reply:', e); }
           return;
        }

        let rejectMsg = 'Pedido rechazado';
        if (reasonCode === 'monto') rejectMsg = '💰 Monto Incompleto';
        else if (reasonCode === 'duplicado') rejectMsg = '⚠️ Pago duplicado';
        else if (reasonCode === 'captura') rejectMsg = '🖼️ Error captura no cargó, enviar el pago nuevamente';
        else if (reasonCode === 'noref') rejectMsg = '🔍 Referencia de pago no encontrada';
        else if (reasonCode === 'general') rejectMsg = '🚫 Pedido rechazado';

        try {
          const dbRef = appInstance.database().ref('orders/' + orderId);
          const snap = await dbRef.once('value');
          const orderData = snap.val();

          if (!orderData || orderData.status !== 'pending') {
            try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Este pedido ya fue procesado.', show_alert: true }); } catch(e){}
            return;
          }

          const statusHistory = orderData.statusHistory || [];
          statusHistory.push({ status: 'rejected', timestamp: new Date().toISOString(), note: rejectMsg });

          await dbRef.update({
            status: 'rejected', adminNote: rejectMsg, rejectReason: rejectMsg,
            updatedAt: new Date().toISOString(), statusHistory
          });

          // Reembolso si pagó con monedero
          if (orderData.paymentMethodId === 'wallet' && orderData.userId && orderData.productType !== 'wallet-recharge') {
            try {
              const walletRef = appInstance.database().ref('users/' + orderData.userId + '/wallet');
              const walletSnap = await walletRef.once('value');
              const amountToRefund = parseFloat(orderData.priceUsd || 0);
              await walletRef.set((parseFloat(walletSnap.val() || 0)) + amountToRefund);
              await appInstance.database().ref('users/' + orderData.userId + '/transactions').push({
                id: Date.now().toString(), type: 'deposit', amount: amountToRefund,
                description: `Pago reembolsado por pedido rechazado (#${orderData.id})`, date: Date.now()
              });
              console.log(`💸 Reembolso de $${amountToRefund} aplicado a ${orderData.userId}`);
            } catch(e) { console.error('Error reembolsando monedero:', e); }
          }
          
          try {
            if (orderData.userId) {
              const isWallet = orderData.productType === 'wallet-recharge';
              await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
                title: isWallet ? 'Recarga Rechazada ❌' : 'Pedido Rechazado ❌',
                body: isWallet 
                  ? `Tu solicitud de recarga de monedero por $${parseFloat(orderData.priceUsd||0).toFixed(2)} ha sido rechazada. Nota: ${rejectMsg}`
                  : `Tu pedido de ${orderData.productName} ha sido rechazado. Nota: ${rejectMsg}`,
                type: isWallet ? 'wallet' : 'order',
                timestamp: new Date().toISOString(),
                read: false
              });
              console.log(`🔔 Notificación de rechazo enviada al usuario ${orderData.userId}`);
            }
          } catch(e) { console.error('Error enviando notificación de rechazo:', e); }

          const newMarkup = {
            inline_keyboard: [
              [{ text: `❌ ${rejectMsg.toUpperCase()}`, callback_data: 'noop' }],
              [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
            ]
          };
          try { await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId }); } catch(e) {
            console.error(`[${storeName}] Error editando markup en rejectreason:`, e.message);
          }
          console.log(`❌ [${storeName}] Pedido #${orderId} RECHAZADO: ${rejectMsg}`);
        } catch(e) {
          console.error(`[${storeName}] Error en rejectreason para #${orderId}:`, e.message);
        }
        return;
      }

      // ── APROBAR / RECHAZAR (mostrar motivos) ──
      const action = data.split('_')[0];
      const orderId = data.substring(action.length + 1);
      const appInstance = storeApps[storeName];

      if (telegramLocks.has(orderId)) {
        console.log(`[${storeName}] ⏳ Bloqueado por telegramLocks:`, orderId);
        try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⏳ Ya se está procesando este pedido...' }); } catch(e){}
        return;
      }
      telegramLocks.add(orderId);
      console.log(`[${storeName}] 🔒 Lock activado para:`, orderId);

      try {
        console.log(`[${storeName}] 📡 Consultando Firebase para el pedido:`, orderId);
        const dbRef = appInstance.database().ref('orders/' + orderId);
        const snap = await dbRef.once('value');
        const orderData = snap.val();

        if (!orderData || orderData.status !== 'pending') {
          console.log(`[${storeName}] ⚠️ Pedido no existe o ya procesado: #${orderId}`);
          try {
            await botConfig.bot.editMessageReplyMarkup(
              { inline_keyboard: [[{ text: '⚠️ Pedido ya procesado o no existe', callback_data: 'noop' }], [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]] },
              { chat_id: chatId, message_id: messageId }
            );
          } catch(e) {}
          return;
        }

        if (action === 'reject') {
          // Mostrar menú de motivos de rechazo
          console.log(`[${storeName}] ❌ Mostrando opciones de rechazo para:`, orderId);
          const newMarkup = {
            inline_keyboard: [
              [{ text: '💰 Monto Incompleto', callback_data: `rejectreason_${orderId}_monto` }],
              [{ text: '⚠️ Pago duplicado', callback_data: `rejectreason_${orderId}_duplicado` }],
              [{ text: '🖼️ Error captura no cargó, enviar el pago nuevamente', callback_data: `rejectreason_${orderId}_captura` }],
              [{ text: '🔍 Referencia de pago no encontrada', callback_data: `rejectreason_${orderId}_noref` }],
              [{ text: '✏️ Rechazo Personalizado', callback_data: `rejectreason_${orderId}_custom` }],
              [{ text: '🚫 Pedido rechazado', callback_data: `rejectreason_${orderId}_general` }],
              [{ text: '🔙 Cancelar', callback_data: `cancelreject_${orderId}` }]
            ]
          };
          try {
            await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
            console.log(`[${storeName}] ✨ Opciones de rechazo enviadas para #${orderId}.`);
          } catch(e) { console.error(`[${storeName}] Error mostrando opciones de rechazo:`, e.message); }

        } else if (action === 'approve') {
          console.log(`[${storeName}] ✅ Procesando aprobación para:`, orderId);
          let newStatus = 'completed';
          let buttonText = '✅ PEDIDO APROBADO';
          let adminNote = 'Pedido realizado exitosamente';

          // Mostrar botón de cargando mientras procesa la API (solo si tiene apiProvider)
          const hasApi = orderData.apiProvider !== undefined && orderData.apiProvider !== null && orderData.apiProvider !== '';
          if (hasApi) {
            try {
              await botConfig.bot.editMessageReplyMarkup(
                { inline_keyboard: [[{ text: '⏳ Procesando recarga...', callback_data: 'noop' }], [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]] },
                { chat_id: chatId, message_id: messageId }
              );
            } catch(e) {}

            console.log(`[${storeName}] 🤖 Pedido tiene API configurada, intentando procesar...`);
            try {
              const apiRes = await processApiTopupFromTelegram(orderData, appInstance);
              console.log(`[${storeName}] 🤖 Respuesta API:`, apiRes);
              newStatus = apiRes.status;
              buttonText = apiRes.msg;
              adminNote = apiRes.dbNote || adminNote;
            } catch(e) { console.error(`[${storeName}] Error en API desde bot:`, e); }
          }

          const statusHistory = orderData.statusHistory || [];
          statusHistory.push({ status: newStatus, timestamp: new Date().toISOString(), note: adminNote });

          console.log(`[${storeName}] 💾 Actualizando BD a status:`, newStatus);
          await dbRef.update({
            status: newStatus, adminNote, updatedAt: new Date().toISOString(), statusHistory
          });

          const finalMarkup = {
            inline_keyboard: [
              [{ text: buttonText, callback_data: 'noop' }],
              [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
            ]
          };
          try {
            await botConfig.bot.editMessageReplyMarkup(finalMarkup, { chat_id: chatId, message_id: messageId });
          } catch(e) { console.error(`[${storeName}] Error actualizando markup final:`, e.message); }
          console.log(`✅ [${storeName}] Pedido #${orderId} aprobado: ${buttonText}`);

          if (newStatus === 'completed') {
            await applyVipRewards(orderData, appInstance, storeName);
            await applyWalletAndReferralRewards(orderData, appInstance, storeName);
            
            try {
              if (orderData.userId) {
                await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
                  title: orderData.productType === 'wallet-recharge' ? 'Recarga Exitosa 💵' : 'Pedido Completado ✅',
                  body: orderData.productType === 'wallet-recharge' ? `Tu recarga de monedero por $${parseFloat(orderData.priceUsd||0).toFixed(2)} ha sido procesada con éxito.` : `Tu pedido de ${orderData.productName} ha sido procesado con éxito.${adminNote ? ` Nota: ${adminNote}` : ''}`,
                  type: orderData.productType === 'wallet-recharge' ? 'wallet' : 'order',
                  timestamp: new Date().toISOString(),
                  read: false
                });
                console.log(`🔔 Notificación de aprobación enviada al usuario ${orderData.userId}`);
              }
            } catch(e) { console.error('Error enviando notificación de aprobación:', e); }
          }

          if (adminNote && (adminNote.includes('Código entregado') || adminNote.includes('Códigos entregados'))) {
            const codeMsg = `🤖 <b>ENTREGA DE CÓDIGO — #${orderId}</b>\n\n${adminNote}`;
            await botConfig.bot.sendMessage(chatId, codeMsg, { parse_mode: 'HTML' }).catch(console.error);
          }

          if (newStatus === 'rejected') {
            try {
              if (orderData.userId) {
                await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
                  title: 'Pedido Rechazado ❌',
                  body: `Tu pedido de ${orderData.productName || 'producto'} ha sido rechazado. Nota: ${adminNote || 'Rechazado por API'}`,
                  type: 'order',
                  timestamp: new Date().toISOString(),
                  read: false
                });
                console.log(`🔔 Notificación de RECHAZO (API) enviada al usuario ${orderData.userId}`);
              }
            } catch (e) {
              console.error('Error enviando notificación de rechazo (API):', e);
            }
          }

          if (newStatus === 'processing') {
            try {
              if (orderData.userId) {
                await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
                  title: 'Pedido en Proceso ⚙️',
                  body: `Tu pedido de ${orderData.productName || 'producto'} ahora está: PROCESANDO ⚙️.`,
                  type: 'order',
                  timestamp: new Date().toISOString(),
                  read: false
                });
                console.log(`🔔 Notificación de PROCESANDO enviada al usuario ${orderData.userId}`);
              }
            } catch (e) {
              console.error('Error enviando notificación de proceso:', e);
            }

            pollApiStatus(orderId, orderData, appInstance, storeName, chatId, messageId);
          }
        }
      } catch (e) {
        console.error(`[${storeName}] Error procesando callback para #${orderId}:`, e.message);
        try {
          await botConfig.bot.editMessageReplyMarkup(
            { inline_keyboard: [[{ text: '❌ Error interno — intenta de nuevo', callback_data: 'noop' }], [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch(err) {}
      } finally {
        telegramLocks.delete(orderId);
        console.log(`[${storeName}] 🔓 Lock liberado para:`, orderId);
      }
    } catch (criticalError) {
      console.error(`[${storeName}] 💥 ERROR CRÍTICO en callback_query:`, criticalError.message);
    }
  });
});

// Función para procesar la API de Recargas directamente desde Node.js
async function processApiTopupFromTelegram(order, appInstance) {
  const apiConfigsSnap = await appInstance.database().ref('api_configs').once('value');
  const apiConfigs = apiConfigsSnap.val() || [];
  
  const apiIdx = parseInt(order.apiProvider);
  if (isNaN(apiIdx) || !apiConfigs[apiIdx] || !apiConfigs[apiIdx].enabled) {
    return { status: 'completed', msg: '✅ APROBADO (Local)', dbNote: 'Pedido realizado exitosamente' };
  }
  
  const api = apiConfigs[apiIdx];
  const apiProductId = parseInt(order.apiProductId);
  if (isNaN(apiProductId)) {
    return { status: 'completed', msg: '✅ APROBADO (Local, Faltó ID Servicio)', dbNote: 'Pedido realizado exitosamente' };
  }
  
  const baseUrl = api.baseUrl.endsWith('/') ? api.baseUrl.slice(0, -1) : api.baseUrl;
  const rectificationCount = (order.statusHistory || []).filter(h => h.note && h.note.includes('rectificó')).length;
  const finalMerchantRef = rectificationCount > 0 ? `${order.id}_R${rectificationCount}` : order.id;

  const payload = {
    producto_id: apiProductId,
    merchant_ref: finalMerchantRef,
    cantidad: 1
  };

  if (order.gameId) {
    if (order.productType === 'game-id-zone') {
      const match = order.gameId.match(/ID:\s*(.+?)\s*\|\s*Zona:\s*(.+)/i);
      if (match) {
        payload.id_juego = match[1].trim();
        payload.input2 = match[2].trim();
      } else {
        payload.id_juego = order.gameId;
      }
    } else {
      payload.id_juego = order.gameId;
    }
  }

  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/comprar`);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': api.apiKey || ''
      },
      timeout: 15000 // 15 segundos máximo
    };
    
    const req = https.request(url, options, (res) => {
      let dataStr = '';
      res.on('data', chunk => dataStr += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(dataStr);
          if (data.ok && data.estado === 'completado') {
             let note = 'Pedido realizado exitosamente';
             if (data.codigo) note = 'Código entregado: ' + data.codigo;
             if (data.codigos && data.codigos.length > 0) note = 'Códigos entregados:\n' + data.codigos.join('\n');
             resolve({ status: 'completed', msg: '✅ RECARGA EXITOSA (API)', dbNote: note });
          } else if (data.ok && data.estado === 'procesando') {
             resolve({ status: 'processing', msg: '⏳ API PROCESANDO...', dbNote: 'Procesando en API externa...' });
          } else {
             const errorStr = (data.error || '').toLowerCase();
             if (errorStr.includes('ya fue usado') || errorStr.includes('already used')) {
                resolve({ status: 'completed', msg: '✅ APROBADO (Ya usado)', dbNote: 'Pedido realizado exitosamente' });
             } else if (errorStr.includes('saldo') || errorStr.includes('balance') || errorStr.includes('pin') || errorStr.includes('stock')) {
                resolve({ status: 'processing', msg: '⚠️ PAUSADO: Sin Saldo/Stock', dbNote: `TiendaGiftVen: ${data.error}` });
             } else {
                resolve({ status: 'invalid-id', msg: `❌ RECHAZADO API: ${data.error}`, dbNote: `ID Invalido: ${data.error}` });
             }
          }
        } catch(e) {
          resolve({ status: 'processing', msg: '⚠️ API ERROR (Manual)', dbNote: 'Error leyendo API. Requiere revisión manual.' });
        }
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'processing', msg: '⏳ TIMEOUT API', dbNote: 'La API externa tardó demasiado. Requiere revisión manual.' });
    });
    
    req.on('error', (e) => {
      resolve({ status: 'processing', msg: '⚠️ API CAÍDA', dbNote: 'Fallo de conexión. Requiere revisión manual.' });
    });
    
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function updateOrderAndTelegram(dbRef, newStatus, adminNote, buttonText, botConfig, chatId, messageId, storeName, orderId) {
    const snap = await dbRef.once('value');
    const orderData = snap.val();
    if (!orderData) return;
    
    // Evitar enviar duplicados si ya fue completado por el frontend
    if (orderData.status === 'completed' || orderData.status === 'invalid-id' || orderData.status === 'rejected') {
        console.log(`⏩ [${storeName}] Pedido #${orderId} ya estaba en ${orderData.status}. Omitiendo actualización de Telegram.`);
        return;
    }
    
    const statusHistory = orderData.statusHistory || [];
    statusHistory.push({
        status: newStatus,
        timestamp: new Date().toISOString(),
        note: adminNote
    });

    await dbRef.update({
        status: newStatus,
        adminNote: adminNote,
        updatedAt: new Date().toISOString(),
        statusHistory: statusHistory
    });

    const newMarkup = {
        inline_keyboard: [
            [{ text: buttonText, callback_data: 'noop' }],
            [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
        ]
    };
    try {
        if (chatId && messageId) {
            await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
            console.log(`✅ [${storeName}] Pedido #${orderId} actualizado tras polling: ${buttonText}`);
        } else {
            const botMsg = `🤖 <b>RECUPERACIÓN AUTOMÁTICA — #${orderId}</b>\n\nEl servidor rescató este pedido que estaba "Procesando" y ha finalizado.\n\nResultado: <b>${buttonText}</b>`;
            await botConfig.bot.sendMessage(botConfig.chatId, botMsg, { parse_mode: 'HTML', reply_markup: JSON.stringify(newMarkup) });
            console.log(`✅ [${storeName}] Pedido #${orderId} recuperado por el backend: ${buttonText}`);
        }

        if (adminNote && (adminNote.includes('Código entregado') || adminNote.includes('Códigos entregados'))) {
            const targetChat = chatId || botConfig.chatId;
            const codeMsg = `🤖 <b>ENTREGA AUTOMÁTICA — #${orderId}</b>\n\n${adminNote}`;
            await botConfig.bot.sendMessage(targetChat, codeMsg, { parse_mode: 'HTML' }).catch(console.error);
        }

        // Aplicar puntos y cashback VIP cuando el pedido se completa por polling API
        if (newStatus === 'completed') {
            const appInstance = storeApps[storeName];
            if (appInstance) {
                await applyVipRewards(orderData, appInstance, storeName);
                await applyWalletAndReferralRewards(orderData, appInstance, storeName);
            }
        }

        // --- ENVIAR NOTIFICACIÓN AL USUARIO ---
        if (newStatus === 'completed' || newStatus === 'rejected' || newStatus === 'invalid-id' || newStatus === 'processing') {
            const appInstance = storeApps[storeName];
            if (appInstance && orderData.userId) {
                const statusLabels = { processing: 'Procesando ⚙️', completed: 'Completado ✅', rejected: 'Rechazado ❌', 'invalid-id': 'ID Inválido ⚠️' };
                const statusText = statusLabels[newStatus] || newStatus.toUpperCase();
                
                let title = 'Actualización de Pedido 📦';
                let type = 'order';
                let body = `Tu pedido de ${orderData.productName || 'producto'} ahora está: ${statusText}.`;
                
                if (newStatus === 'completed' && orderData.productType === 'wallet-recharge') {
                    title = 'Recarga Exitosa 💵';
                    body = `Tu recarga de monedero por $${parseFloat(orderData.priceUsd||0).toFixed(2)} ha sido procesada con éxito.`;
                    type = 'wallet';
                } else if (newStatus === 'rejected') {
                    title = 'Pedido Rechazado ❌';
                    body = `Tu pedido de ${orderData.productName || 'producto'} ha sido rechazado. Nota: ${adminNote || 'Sin nota'}`;
                } else if (newStatus === 'invalid-id') {
                    title = 'ID Inválido ⚠️';
                    body = `El ID proporcionado para ${orderData.productName || 'tu pedido'} es inválido. Nota: ${adminNote || 'Verifica tu ID'}`;
                } else if (newStatus === 'completed') {
                    title = 'Pedido Completado ✅';
                    body = `Tu pedido de ${orderData.productName || 'producto'} ha sido procesado con éxito.${adminNote ? ` Nota: ${adminNote}` : ''}`;
                }

                await appInstance.database().ref('users/' + orderData.userId + '/notifications').push({
                    title: title,
                    body: body,
                    type: type,
                    timestamp: new Date().toISOString(),
                    read: false
                });
                console.log(`🔔 Notificación de ${newStatus} enviada al usuario ${orderData.userId} desde background polling`);
            }
        }
    } catch(e) {
        console.error(`❌ [${storeName}] Error editando/enviando msj en polling para #${orderId}`, e.message);
    }
}

const activePolls = new Set();

async function pollApiStatus(orderId, orderData, appInstance, storeName, chatId, messageId) {
  if (activePolls.has(orderId)) return;
  
  const apiConfigsSnap = await appInstance.database().ref('api_configs').once('value');
  const apiConfigs = apiConfigsSnap.val() || [];
  const apiIdx = parseInt(orderData.apiProvider);
  if (isNaN(apiIdx) || !apiConfigs[apiIdx]) return;
  
  activePolls.add(orderId);
  const api = apiConfigs[apiIdx];
  const baseUrl = api.baseUrl.endsWith('/') ? api.baseUrl.slice(0, -1) : api.baseUrl;
  const botConfig = bots[storeName];

  const rectificationCount = (orderData.statusHistory || []).filter(h => h.note && h.note.includes('rectificó')).length;
  const finalMerchantRef = rectificationCount > 0 ? `${orderId}_R${rectificationCount}` : orderId;

  let attempts = 0;
  const maxAttempts = 60; // 60 * 5 = 300 seconds (5 minutos)
  const dbRef = appInstance.database().ref('orders/' + orderId);

  const pollInterval = setInterval(async () => {
    attempts++;
    try {
      const url = new URL(`${baseUrl}/recargas/status?merchant_ref=${finalMerchantRef}`);
      const options = {
        method: 'GET',
        headers: { 'X-API-Key': api.apiKey || '' }
      };

      const req = https.request(url, options, (res) => {
        let dataStr = '';
        res.on('data', chunk => dataStr += chunk);
        res.on('end', async () => {
          try {
            const pollData = JSON.parse(dataStr);
            const estadoStr = String(pollData.estado || pollData.status || '').toLowerCase();
            
            if (pollData.ok && (estadoStr === 'completado' || estadoStr === 'completed')) {
              clearInterval(pollInterval);
              activePolls.delete(orderId);
              let note = 'Aprobado y entregado automáticamente (luego de procesar)';
              if (pollData.codigo) note = 'Código entregado: ' + pollData.codigo;
              if (pollData.codigos && pollData.codigos.length > 0) note = 'Códigos entregados:\n' + pollData.codigos.join('\n');
              
              await updateOrderAndTelegram(dbRef, 'completed', note, '✅ APROBADO Y COMPLETADO', botConfig, chatId, messageId, storeName, orderId);

            } else if (pollData.ok && (estadoStr === 'procesando' || estadoStr === 'processing')) {
              if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                activePolls.delete(orderId);
                await updateOrderAndTelegram(dbRef, 'processing', 'La API no dio respuesta final tras 5 minutos. Requiere revisión manual.', '⚠️ PROCESANDO (Timeout)', botConfig, chatId, messageId, storeName, orderId);
              }
            } else {
              clearInterval(pollInterval);
              activePolls.delete(orderId);
              let errorMsg = pollData.error || pollData.msg || pollData.estado || 'Rechazado';
              const errorLower = String(errorMsg).toLowerCase();
              if (errorLower.includes('ya fue usado') || errorLower.includes('already used')) {
                await updateOrderAndTelegram(dbRef, 'completed', `Aprobado forzadamente (API indicó: ${errorMsg})`, '✅ APROBADO (Ya usado)', botConfig, chatId, messageId, storeName, orderId);
              } else {
                let clientNote = 'ID Inválido o producto no disponible';
                if (errorLower.includes('saldo') || errorLower.includes('balance') || errorLower.includes('pin') || errorLower.includes('stock')) {
                    clientNote = 'El proveedor se quedó sin saldo o stock. Revisión manual requerida.';
                    await updateOrderAndTelegram(dbRef, 'processing', clientNote, `⚠️ PAUSADO: Sin Saldo/Stock`, botConfig, chatId, messageId, storeName, orderId);
                    
                    // Alerta admin
                    const alertMsg = `⚠️ <b>ALERTA DE FONDOS / STOCK</b> ⚠️\n\nEl pedido #${orderId} no pudo ser procesado porque TiendaGiftVen indicó falta de saldo o pines.\n\n<b>Error:</b> ${errorMsg}\n\nEl pedido quedó en "PROCESANDO". Complétalo manualmente.`;
                    await botConfig.bot.sendMessage(botConfig.chatId, alertMsg, { parse_mode: 'HTML' });
                } else {
                    if (errorLower.includes('id') || errorLower.includes('cuenta') || errorLower.includes('jugador') || errorLower.includes('not found')) {
                        clientNote = 'Verifica que el ID o la cuenta sean correctos.';
                    }
                    await updateOrderAndTelegram(dbRef, 'invalid-id', clientNote, `❌ RECHAZADO API: ${errorMsg}`, botConfig, chatId, messageId, storeName, orderId);
                }
              }
            }
          } catch (e) {
            if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              activePolls.delete(orderId);
              await updateOrderAndTelegram(dbRef, 'processing', 'Marcado para revisión manual tras 5 min (Error API).', '⚠️ ERROR API (Manual)', botConfig, chatId, messageId, storeName, orderId);
            }
          }
        });
      });

      req.on('error', (e) => {
        if (attempts >= maxAttempts) {
           clearInterval(pollInterval);
           activePolls.delete(orderId);
           updateOrderAndTelegram(dbRef, 'completed', 'Marcado completado automático (Error Red).', '✅ APROBADO (Error Red)', botConfig, chatId, messageId, storeName, orderId).catch(console.error);
        }
      });
      req.end();

    } catch(e) {
      if (attempts >= maxAttempts) {
         clearInterval(pollInterval);
         activePolls.delete(orderId);
      }
    }
  }, 5000);
}

/**
 * Borra cualquier webhook activo en todos los bots.
 * IMPORTANTE: Si un bot tiene webhook, los callback_queries van al webhook
 * y el polling NUNCA los recibe. Esto congela los botones de Telegram.
 */
async function clearAllWebhooks() {
  console.log('\n🔗 Verificando y borrando webhooks activos...');
  for (const [storeName, botConfig] of Object.entries(bots)) {
    try {
      const info = await botConfig.bot.getWebHookInfo();
      if (info && info.url && info.url.length > 0) {
        console.log(`⚠️  [${storeName}] Webhook ACTIVO detectado: ${info.url}`);
        await botConfig.bot.deleteWebHook();
        console.log(`✅ [${storeName}] Webhook eliminado. Ahora usa polling correctamente.`);
      } else {
        console.log(`✅ [${storeName}] Sin webhook. Polling activo.`);
      }
    } catch(e) {
      console.error(`❌ [${storeName}] Error verificando webhook:`, e.message);
    }
  }
  console.log('🔗 Verificación de webhooks completada.\n');
}

/**
 * Repara los botones congelados en Telegram.
 * Busca pedidos 'pending' que ya tienen telegramMessageId y les
 * vuelve a aplicar los botones Aprobar/Rechazar.
 * Esto descongela los mensajes viejos que quedaron sin responder.
 */
async function repairFrozenButtons() {
  console.log('\n🔧 Reparando botones congelados en Telegram...');
  const stores = [
    { name: 'CandyStore', app: candyStoreApp },
    { name: 'RecargaShark', app: recargaSharkApp },
    { name: 'AccessPlay', app: accessPlayApp }
  ];

  let totalRepaired = 0;

  for (const store of stores) {
    const botConfig = bots[store.name];
    if (!botConfig || !botConfig.chatId) continue;

    try {
      const ordersRef = store.app.database().ref('orders');
      const snapshot = await ordersRef.once('value');
      const allOrders = snapshot.val();
      if (!allOrders) continue;

      for (const [orderId, orderData] of Object.entries(allOrders)) {
        // Solo reparar pedidos pending que ya tienen mensaje de Telegram
        if (orderData.status !== 'pending' || !orderData.telegramMessageId || !orderData.botProcessed) continue;
        // Saltar pedidos de monedero (no necesitan botones manuales)
        if (orderData.paymentMethodId === 'wallet') continue;

        try {
          const repairMarkup = {
            inline_keyboard: [
              [
                { text: '✅ Aprobar', callback_data: `approve_${orderId}` },
                { text: '❌ Rechazar', callback_data: `reject_${orderId}` }
              ],
              [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
            ]
          };
          await botConfig.bot.editMessageReplyMarkup(
            repairMarkup,
            { chat_id: botConfig.chatId, message_id: orderData.telegramMessageId }
          );
          totalRepaired++;
          console.log(`🔧 [${store.name}] Botón reparado: #${orderId} (msg ${orderData.telegramMessageId})`);
          // Pequeña pausa para no saturar la API de Telegram
          await new Promise(r => setTimeout(r, 300));
        } catch(e) {
          if (!e.message.includes('not modified') && !e.message.includes('message to edit not found')) {
            console.warn(`⚠️  [${store.name}] No se pudo reparar #${orderId}:`, e.message);
          }
        }
      }
    } catch(err) {
      console.error(`❌ [${store.name}] Error durante reparación de botones:`, err.message);
    }
  }

  if (totalRepaired > 0) {
    console.log(`🔧 Reparación completada. ${totalRepaired} botón(es) restaurados.\n`);
  } else {
    console.log('🔧 No se encontraron botones que reparar.\n');
  }
}

// Iniciar el sistema:
// 1. Borrar webhooks (para asegurarse de que el polling funcione)
// 2. Limpiar pedidos maliciosos (XSS)
// 3. Reparar botones congelados en mensajes viejos
// 4. Iniciar los listeners en tiempo real
// 5. Iniciar limpieza periódica del baúl bancario
(async () => {
  await clearAllWebhooks();
  await cleanupMaliciousOrders();
  await repairFrozenButtons();
  startListening();

  // ── Limpieza periódica del baúl de pagos bancarios (cada 1 hora) ──
  setInterval(async () => {
    try {
      const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 horas
      const db = accessPlayApp.database();

      // Limpiar bank_vault (entries > 24h)
      const vaultSnap = await db.ref('bank_vault').once('value');
      const vaultData = vaultSnap.val();
      if (vaultData) {
        const updates = {};
        let cleaned = 0;
        for (const [key, entry] of Object.entries(vaultData)) {
          if (entry.timestamp && entry.timestamp < cutoff) {
            updates[key] = null; // null = eliminar en Firebase
            cleaned++;
          }
        }
        if (cleaned > 0) {
          await db.ref('bank_vault').update(updates);
          console.log(`🧹 [Vault] Limpieza: ${cleaned} entries antiguas eliminadas del baúl bancario.`);
        }
      }

      // Limpiar bank_notifications (procesadas y > 24h)
      const notifSnap = await db.ref('bank_notifications').once('value');
      const notifData = notifSnap.val();
      if (notifData) {
        const updates = {};
        let cleaned = 0;
        for (const [key, entry] of Object.entries(notifData)) {
          if (entry.receivedAt && entry.receivedAt < cutoff) {
            updates[key] = null;
            cleaned++;
          }
        }
        if (cleaned > 0) {
          await db.ref('bank_notifications').update(updates);
          console.log(`🧹 [BankNotif] Limpieza: ${cleaned} notificaciones antiguas eliminadas.`);
        }
      }
    } catch(e) {
      console.error('❌ Error en limpieza periódica del baúl bancario:', e.message);
    }
  }, 60 * 60 * 1000); // Cada 1 hora

  console.log('🧹 Limpieza periódica del baúl bancario programada (cada 1 hora).');
})();
