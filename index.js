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
    // Solo aplicar a compras de productos (no recargas de monedero)
    if (!orderData.userId || orderData.productType === 'wallet-recharge') return;

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
  } catch (e) {
    console.error(`❌ [${storeName}] Error aplicando VIP rewards para #${orderData.id}:`, e.message);
  }
}

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
    const normalizedText = text.toLowerCase()
      .replace(/[áäâà]/g, 'a').replace(/[éëêè]/g, 'e').replace(/[íïîì]/g, 'i')
      .replace(/[óöôò]/g, 'o').replace(/[úüûù]/g, 'u');

    // Expresión regular mejorada para bancos (incluye recibo, comprobante, transaccion)
    const keywordRegex = /(?:referencia|ref\.|ref|recibo|comprobante|transaccion|aprobacion|numero\s+de\s+operacion|operacion|tipo\s+de\s+operacion|numero\s+de\s+referencia)[\s\S]{0,35}?(\d{4,25})/gi;
    
    let ocrNumbers = [];
    let match;
    
    // Buscar todas las coincidencias
    while ((match = keywordRegex.exec(normalizedText)) !== null) {
      ocrNumbers.push(match[1]);
    }

    // Si la búsqueda con palabras clave no encuentra nada, buscar el número más largo como "plan B"
    if (ocrNumbers.length === 0) {
      console.log('⚠️ Palabras clave no encontradas. Intentando buscar números largos por fuerza bruta...');
      // Buscar números aislados de 5 a 25 dígitos (evita fechas como 2024)
      const fallbackMatches = text.match(/(?<!\d)\d{5,25}(?!\d)/g);
      if (fallbackMatches) {
        // Filtramos números de teléfono venezolanos (11 dígitos que empiezan en 04)
        ocrNumbers = [...new Set(fallbackMatches)]
          .filter(num => !(num.length === 11 && num.startsWith('04')))
          .sort((a, b) => b.length - a.length);
      }
    } else {
      // Eliminar duplicados si hay varios
      ocrNumbers = [...new Set(ocrNumbers)];
    }

    console.log('✅ OCR Terminado. Referencias encontradas:', ocrNumbers);
    return ocrNumbers;
  } catch (error) {
    console.error('❌ Error en OCR:', error);
    return [];
  }
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
  const isWallet = order.paymentMethodId === 'wallet' || (order.paymentMethodName && order.paymentMethodName.toLowerCase().includes('monedero'));
  const isAlreadyProcessed = order.status !== 'pending';

  if (isWallet || isAlreadyProcessed) {
    if (pendingOrderIds.has(orderId)) pendingOrderIds.delete(orderId);
    if (isWallet) {
      console.log(`⚡ [${storeName}] Pedido #${orderId} pagado con Monedero. Añadiendo a la cola sin foto.`);
    } else {
      console.log(`⏩ [${storeName}] Pedido #${orderId} ya estaba en estado '${order.status}'. Añadiendo a la cola sin foto.`);
    }
    orderQueue.add(() => executeProcess(order, storeName, dbRef));
    return;
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
      if (ocrResult.length > 0) {
        await dbRef.update({ ocrNumbers: ocrResult });
        
        // Buscar si esta referencia ya existe en otros pedidos (últimos 150 pedidos)
        const snap = await dbRef.parent.orderByChild('createdAt').limitToLast(150).once('value');
        const allOrders = snap.val() || {};
        for (const [key, oldOrder] of Object.entries(allOrders)) {
          if (key === order.id) continue;
          if (oldOrder.ocrNumbers && Array.isArray(oldOrder.ocrNumbers)) {
             const hasDuplicate = ocrResult.some(num => oldOrder.ocrNumbers.includes(num));
             if (hasDuplicate) {
               duplicateOrders.push(key);
             }
          }
        }
      }
    } catch (e) {
      console.error('❌ Error OCR:', e.message);
    }
  }

  // AUTO-API PARA PAGOS CON MONEDERO (Si la API está encendida)
  const appInstance = storeApps[storeName];
  if (order.paymentMethodId === 'wallet' && order.status === 'pending') {
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
      } catch(e) {
        console.error('Error auto-disparando API para monedero:', e);
      }
    }
  }

  await sendTelegramNotification(order, storeName, ocrResult, imageBuffer, duplicateOrders, exifrWarning, dbRef);

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

  const refText = ocrResult.length > 0 ? ocrResult.join(', ') : 'No detectado / Ver foto';
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

function startListening() {
  const stores = [
    { name: 'CandyStore', app: candyStoreApp },
    { name: 'RecargaShark', app: recargaSharkApp },
    { name: 'AccessPlay', app: accessPlayApp }
  ];

  stores.forEach(store => {
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

    console.log(`👂 Escuchando en tiempo real: ${store.name}`);
  });

  console.log('🚀 CEREBRO CENTRAL EN LÍNEA Y ESPERANDO PEDIDOS...');
}

// ========================================
// 8. ESCUCHAR BOTONES DE TELEGRAM (CALLBACKS)
// ========================================
const storeApps = { CandyStore: candyStoreApp, RecargaShark: recargaSharkApp, AccessPlay: accessPlayApp };
const telegramLocks = new Set(); // Candado anti doble-clic en Telegram

Object.keys(bots).forEach(storeName => {
  const botConfig = bots[storeName];
  botConfig.bot.on('callback_query', async (query) => {
    console.log(`[${storeName}] ➡️ Recibido callback_query:`, query.data);
    try {
      const data = query.data || '';
      if (!query.message) {
        console.log(`[${storeName}] ⚠️ Callback sin mensaje asociado.`);
        return;
      }

      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      if (data === 'ignore' || data === 'noop') {
        try { await botConfig.bot.answerCallbackQuery(query.id); } catch(e){}
        return;
      }

      if (!data.startsWith('approve_') && !data.startsWith('reject_') && !data.startsWith('rejectreason_') && !data.startsWith('cancelreject_')) {
        console.log(`[${storeName}] ⚠️ Callback data ignorado:`, data);
        return;
      }

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
          await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
          await botConfig.bot.answerCallbackQuery(query.id, { text: 'Operación cancelada.' });
          return;
      }

      if (data.startsWith('rejectreason_')) {
          const actionPrefix = 'rejectreason_';
          const rest = data.substring(actionPrefix.length);
          const lastUnderscore = rest.lastIndexOf('_');
          const orderId = rest.substring(0, lastUnderscore);
          const reasonCode = rest.substring(lastUnderscore + 1);
          const appInstance = storeApps[storeName];
          
          let rejectMsg = 'Pedido rechazado';
          if (reasonCode === 'monto') rejectMsg = '💰 Monto Incompleto';
          else if (reasonCode === 'duplicado') rejectMsg = '⚠️ Pago duplicado';
          else if (reasonCode === 'captura') rejectMsg = '🖼️ Error captura no cargó, enviar el pago nuevamente';
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
            statusHistory.push({
              status: 'rejected',
              timestamp: new Date().toISOString(),
              note: rejectMsg
            });

            await dbRef.update({
               status: 'rejected',
               adminNote: rejectMsg,
               rejectReason: rejectMsg,
               updatedAt: new Date().toISOString(),
               statusHistory: statusHistory
            });

            if (orderData.paymentMethodId === 'wallet' && orderData.userId && orderData.productType !== 'wallet-recharge') {
              try {
                const walletRef = appInstance.database().ref('users/' + orderData.userId + '/wallet');
                const walletSnap = await walletRef.once('value');
                const currentWallet = parseFloat(walletSnap.val() || 0);
                const amountToRefund = parseFloat(orderData.priceUsd || 0);
                await walletRef.set(currentWallet + amountToRefund);
                
                await appInstance.database().ref('users/' + orderData.userId + '/transactions').push({
                  id: Date.now().toString(),
                  type: 'deposit',
                  amount: amountToRefund,
                  description: `Pago reembolsado por pedido rechazado (#${orderData.id})`,
                  date: Date.now()
                });
                console.log(`💸 Reembolso de $${amountToRefund} aplicado a ${orderData.userId}`);
              } catch(e) { console.error('Error reembolsando monedero:', e); }
            }
            
            const newMarkup = {
              inline_keyboard: [
                 [{ text: `❌ ${rejectMsg.toUpperCase()}`, callback_data: 'noop' }],
                 [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
              ]
            };
            await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
            await botConfig.bot.answerCallbackQuery(query.id, { text: 'Pedido rechazado y cliente notificado.' });
            console.log(`❌ [${storeName}] Pedido #${orderId} RECHAZADO: ${rejectMsg}`);
          } catch(e) {
            console.error(e);
          }
          return;
      }

      const action = data.split('_')[0]; // "approve" o "reject"
      const orderId = data.substring(action.length + 1); // Extraer el ID
      const appInstance = storeApps[storeName];

      if (telegramLocks.has(orderId)) {
        console.log(`[${storeName}] ⏳ Bloqueado por telegramLocks:`, orderId);
        try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⏳ Procesando pedido, por favor espera...' }); } catch(e){}
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
          console.log(`[${storeName}] ⚠️ Pedido ya no está pendiente o no existe.`);
          try { await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Este pedido ya fue procesado anteriormente o no existe.', show_alert: true }); } catch(e){}
          telegramLocks.delete(orderId);
          return;
        }
        
        if (action === 'approve') {
          console.log(`[${storeName}] ✅ Procesando aprobación para:`, orderId);
          let newStatus = 'completed';
          let buttonText = '✅ PEDIDO APROBADO';
          let adminNote = 'Pedido realizado exitosamente';

          if (orderData && orderData.apiProvider !== undefined && orderData.apiProvider !== null) {
            console.log(`[${storeName}] 🤖 Pedido tiene API configurada, intentando procesar...`);
            try {
              const apiRes = await processApiTopupFromTelegram(orderData, appInstance);
              console.log(`[${storeName}] 🤖 Respuesta API:`, apiRes);
              newStatus = apiRes.status;
              buttonText = apiRes.msg;
              adminNote = apiRes.dbNote || adminNote;
            } catch(e) { console.error('Error procesando API desde bot', e); }
          }

          const statusHistory = orderData.statusHistory || [];
          statusHistory.push({
            status: newStatus,
            timestamp: new Date().toISOString(),
            note: adminNote
          });

          console.log(`[${storeName}] 💾 Actualizando BD a status:`, newStatus);
          await dbRef.update({
             status: newStatus,
             adminNote: adminNote,
             updatedAt: new Date().toISOString(),
             statusHistory: statusHistory
          });

          // Editar los botones del mensaje para mostrar el resultado
          const newMarkup = {
            inline_keyboard: [
               [{ text: buttonText, callback_data: 'noop' }],
               [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
            ]
          };
          console.log(`[${storeName}] 💬 Enviando markup y answerCallbackQuery...`);
          await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
          await botConfig.bot.answerCallbackQuery(query.id, { text: `Resultado: ${buttonText}` });
          console.log(`✅ [${storeName}] Pedido #${orderId} procesado desde Telegram: ${buttonText}`);
          
          // Aplicar puntos y cashback VIP cuando el pedido se completa
          if (newStatus === 'completed') {
            await applyVipRewards(orderData, appInstance, storeName);
          }

          if (adminNote && (adminNote.includes('Código entregado') || adminNote.includes('Códigos entregados'))) {
              const codeMsg = `🤖 <b>ENTREGA DE CÓDIGO — #${orderId}</b>\n\n${adminNote}`;
              await botConfig.bot.sendMessage(chatId, codeMsg, { parse_mode: 'HTML' }).catch(console.error);
          }

          if (newStatus === 'processing') {
              pollApiStatus(orderId, orderData, appInstance, storeName, chatId, messageId);
          }
        } else if (action === 'reject') {
          console.log(`[${storeName}] ❌ Procesando rechazo (mostrando opciones) para:`, orderId);
          const newMarkup = {
            inline_keyboard: [
              [{ text: '💰 Monto Incompleto', callback_data: `rejectreason_${orderId}_monto` }],
              [{ text: '⚠️ Pago duplicado', callback_data: `rejectreason_${orderId}_duplicado` }],
              [{ text: '🖼️ Error captura no cargó, enviar el pago nuevamente', callback_data: `rejectreason_${orderId}_captura` }],
              [{ text: '🚫 Pedido rechazado', callback_data: `rejectreason_${orderId}_general` }],
              [{ text: '🔙 Cancelar', callback_data: `cancelreject_${orderId}` }]
            ]
          };
          await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
          await botConfig.bot.answerCallbackQuery(query.id, { text: 'Selecciona el motivo del rechazo:' });
          console.log(`[${storeName}] ✨ Opciones de rechazo enviadas.`);
        }
      } catch (e) {
        console.error(`Error procesando callback para ${orderId}:`, e);
        try { await botConfig.bot.answerCallbackQuery(query.id, { text: 'Hubo un error interno. Intenta de nuevo.', show_alert: true }); } catch(err) {}
      } finally {
        telegramLocks.delete(orderId); // Liberar el candado
        console.log(`[${storeName}] 🔓 Lock liberado para:`, orderId);
      }
    } catch (criticalError) {
      console.error(`[${storeName}] 💥 ERROR CRÍTICO NO CONTROLADO en callback_query:`, criticalError);
      try { await botConfig.bot.answerCallbackQuery(query.id, { text: 'Error de sistema.', show_alert: true }); } catch(err) {}
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
    if (orderData.status === newStatus || orderData.status === 'completed' || orderData.status === 'invalid-id') {
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
  const maxAttempts = 12; // 12 * 5 = 60 seconds
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
                await updateOrderAndTelegram(dbRef, 'processing', 'La API no dio respuesta final tras 1 minuto. Requiere revisión manual.', '⚠️ PROCESANDO (Timeout)', botConfig, chatId, messageId, storeName, orderId);
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
              await updateOrderAndTelegram(dbRef, 'processing', 'Marcado para revisión manual tras 1 min (Error API).', '⚠️ ERROR API (Manual)', botConfig, chatId, messageId, storeName, orderId);
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

// Iniciar el sistema: primero limpiar pedidos maliciosos, luego escuchar
(async () => {
  await cleanupMaliciousOrders();
  startListening();
})();
