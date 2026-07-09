require('dotenv').config();
const admin = require('firebase-admin');
const TelegramBot = require('node-telegram-bot-api');
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
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
const bots = {
  CandyStore: {
    bot: new TelegramBot(process.env.CANDYSTORE_BOT_TOKEN, { polling: true }),
    chatId: process.env.CANDYSTORE_CHAT_ID,
    emoji: '🍬',
    adminUrl: 'https://candystore-zeta.vercel.app/admin'
  },
  RecargaShark: {
    bot: new TelegramBot(process.env.RECARGASHARK_BOT_TOKEN, { polling: true }),
    chatId: process.env.RECARGASHARK_CHAT_ID,
    emoji: '🦈',
    adminUrl: 'https://admin.recargashark.com/admin'
  },
  AccessPlay: {
    bot: new TelegramBot(process.env.ACCESSPLAY_BOT_TOKEN, { polling: true }),
    chatId: process.env.ACCESSPLAY_CHAT_ID,
    emoji: '🎮',
    adminUrl: 'https://www.accesplay.com/admin'
  }
};

console.log('✅ Bots de Telegram configurados.');

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
// 5. PROCESAMIENTO PRINCIPAL DE PEDIDOS
// ========================================

const pendingOrderIds = new Set();
const processingLocks = new Set(); // Candado anti-duplicados

async function processNewOrder(orderId, storeName, appInstance, eventType) {
  const dbRef = appInstance.database().ref('orders/' + orderId);
  const snapshot = await dbRef.once('value');
  const order = snapshot.val();

  if (!order || order.status !== 'pending' || order.botProcessed) return;

  // Si tiene la captura, lo procesamos INMEDIATAMENTE
  if (order.screenshot) {
    if (pendingOrderIds.has(orderId)) {
      pendingOrderIds.delete(orderId);
    }
    await executeProcess(order, storeName, dbRef);
    return;
  }

  // Si pagó con monedero o saldo, lo procesamos INMEDIATAMENTE sin buscar foto
  const isWallet = order.paymentMethodId === 'wallet' || (order.paymentMethodName && order.paymentMethodName.toLowerCase().includes('monedero'));
  if (isWallet) {
    if (pendingOrderIds.has(orderId)) pendingOrderIds.delete(orderId);
    console.log(`⚡ [${storeName}] Pedido #${orderId} pagado con Monedero. Procesando al instante sin foto.`);
    await executeProcess(order, storeName, dbRef);
    return;
  }

  // Si no tiene captura y es el primer aviso, implementamos el ciclo de búsqueda de 60 segundos
  if (eventType === 'child_added' && !pendingOrderIds.has(orderId)) {
    pendingOrderIds.add(orderId);
    console.log(`🔍 [${storeName}] Pedido #${orderId} registrado. Buscando foto en Storage...`);
    
    const screenshotUrl = `https://firebasestorage.googleapis.com/v0/b/accesplay-8bf5d.firebasestorage.app/o/orders_screenshots%2F${orderId}.jpg?alt=media`;
    let attempts = 0;
    const maxAttempts = 36; // 36 * 5s = 180 segundos (3 minutos de espera máxima)
    
    const pollImage = async () => {
      try {
        // Añadir timestamp para evitar que Firebase guarde en caché el error "404 Not Found" (cache busting)
        const timestampedUrl = `${screenshotUrl}&t=${Date.now()}`;
        const imageBuffer = await getImageBuffer(timestampedUrl);
        
        if (imageBuffer && pendingOrderIds.has(orderId)) {
          pendingOrderIds.delete(orderId);
          console.log(`✅ [${storeName}] Foto encontrada para #${orderId} (Intento ${attempts + 1})`);
          order.screenshot = timestampedUrl;
          await executeProcess(order, storeName, dbRef, imageBuffer);
        }
      } catch (e) {
        attempts++;
        if (attempts >= maxAttempts) {
          if (pendingOrderIds.has(orderId)) {
            pendingOrderIds.delete(orderId);
            console.log(`⚠️ [${storeName}] Expiró el tiempo de espera (3 minutos) para #${orderId}. Procesando sin foto.`);
            order.screenshot = null;
            await executeProcess(order, storeName, dbRef);
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

  if (imageBuffer) {
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

  await sendTelegramNotification(order, storeName, ocrResult, imageBuffer, duplicateOrders);
}

// ========================================
// 6. ENVIAR A TELEGRAM
// ========================================

async function sendTelegramNotification(order, storeName, ocrResult, imageBuffer, duplicateOrders = []) {
  const storeConfig = bots[storeName];
  if (!storeConfig || !storeConfig.bot || !storeConfig.chatId) {
    console.error(`❌ Faltan datos de Telegram para ${storeName}`);
    return;
  }

  // Armar el mensaje
  let msg = `${storeConfig.emoji} <b>NUEVO PEDIDO [${storeName.toUpperCase()}] — #${order.id}</b>\n`;
  msg += `👤 <b>Jugador/Cliente:</b> ${order.playerName || order.customerContact || 'ㅤ'}\n`;
  msg += `🆔 <b>ID / Correo:</b> <code>${order.gameId || order.accountEmail || 'N/A'}</code>\n`;
  msg += `🔥 <b>Producto:</b> ${order.productName} (${order.packageLabel})\n`;
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

  msg += `🏦 <b>Método:</b> ${order.paymentMethodName || 'Desconocido'}\n`;
  msg += `📱 <b>Contacto:</b> ${order.customerContact || 'N/A'}\n`;

  let inline_keyboard = [];
  if (order.paymentMethodId === 'wallet') {
    inline_keyboard = [
       [{ text: '✅ Pagado con Monedero (Automático)', callback_data: 'ignore' }],
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

  // Opciones de botones para el mensaje
  const options = {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: inline_keyboard
    }
  };

  try {
    if (imageBuffer) {
      // Enviar foto con el mensaje como pie de foto (caption)
      options.caption = msg;
      await storeConfig.bot.sendPhoto(storeConfig.chatId, imageBuffer, options);
    } else {
      // Enviar solo texto
      await storeConfig.bot.sendMessage(storeConfig.chatId, msg, options);
    }
    console.log(`✅ [${storeName}] Notificación enviada a Telegram.`);
  } catch (error) {
    console.error(`❌ [${storeName}] Error enviando a Telegram:`, error.message);
  }
}

// ========================================
// 7. INICIAR LA ESCUCHA (LISTENERS)
// ========================================

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
      processNewOrder(snapshot.key, store.name, store.app, 'child_added').catch(err => console.error(err));
    });

    // También escuchar por si el frontend añade la imagen después
    ref.on('child_changed', (snapshot) => {
      processNewOrder(snapshot.key, store.name, store.app, 'child_changed').catch(err => console.error(err));
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
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (!data.startsWith('approve_') && !data.startsWith('reject_')) return;

    const action = data.split('_')[0]; // "approve" o "reject"
    const orderId = data.substring(action.length + 1); // Extraer el ID
    const appInstance = storeApps[storeName];

    // Evitar doble-clic instantáneo
    if (telegramLocks.has(orderId)) {
      await botConfig.bot.answerCallbackQuery(query.id, { text: '⏳ Procesando pedido, por favor espera...' });
      return;
    }
    telegramLocks.add(orderId);

    try {
      const dbRef = appInstance.database().ref('orders/' + orderId);
      const snap = await dbRef.once('value');
      const orderData = snap.val();

      // Verificar que el pedido siga pendiente antes de hacer nada
      if (!orderData || orderData.status !== 'pending') {
        await botConfig.bot.answerCallbackQuery(query.id, { text: '⚠️ Este pedido ya fue procesado anteriormente.', show_alert: true });
        telegramLocks.delete(orderId);
        return;
      }
      
      if (action === 'approve') {
        
        let newStatus = 'completed';
        let buttonText = '✅ PEDIDO APROBADO';
        let adminNote = 'Pedido realizado exitosamente';

        // Intentar procesar la API si el pedido la tiene configurada
        if (orderData && orderData.apiProvider !== undefined && orderData.apiProvider !== null) {
          try {
            const apiRes = await processApiTopupFromTelegram(orderData, appInstance);
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
        await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
        await botConfig.bot.answerCallbackQuery(query.id, { text: `Resultado: ${buttonText}` });
        console.log(`✅ [${storeName}] Pedido #${orderId} procesado desde Telegram: ${buttonText}`);
      } else if (action === 'reject') {
        const statusHistory = orderData.statusHistory || [];
        statusHistory.push({
          status: 'rejected',
          timestamp: new Date().toISOString(),
          note: 'Pedido rechazado'
        });

        await dbRef.update({
           status: 'rejected',
           adminNote: 'Pedido rechazado',
           updatedAt: new Date().toISOString(),
           statusHistory: statusHistory
        });
        const newMarkup = {
          inline_keyboard: [
             [{ text: '❌ PEDIDO RECHAZADO', callback_data: 'noop' }],
             [{ text: '🔍 Abrir Panel Admin', url: botConfig.adminUrl }]
          ]
        };
        await botConfig.bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
        await botConfig.bot.answerCallbackQuery(query.id, { text: 'Pedido rechazado en la base de datos.' });
        console.log(`❌ [${storeName}] Pedido #${orderId} RECHAZADO desde Telegram.`);
      }
    } catch (e) {
      console.error(`Error procesando callback para ${orderId}:`, e);
      await botConfig.bot.answerCallbackQuery(query.id, { text: 'Hubo un error al actualizar la base de datos.', show_alert: true });
    } finally {
      telegramLocks.delete(orderId); // Liberar el candado
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
      }
    };
    
    const req = https.request(url, options, (res) => {
      let dataStr = '';
      res.on('data', chunk => dataStr += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(dataStr);
          if (data.ok && data.estado === 'completado') {
             resolve({ status: 'completed', msg: '✅ RECARGA EXITOSA (API)', dbNote: 'Pedido realizado exitosamente' });
          } else if (data.ok && data.estado === 'procesando') {
             resolve({ status: 'processing', msg: '⏳ API PROCESANDO...', dbNote: 'Procesando en API externa...' });
          } else {
             const errorStr = (data.error || '').toLowerCase();
             if (errorStr.includes('ya fue usado') || errorStr.includes('already used')) {
                resolve({ status: 'completed', msg: '✅ APROBADO (Ya usado)', dbNote: 'Pedido realizado exitosamente' });
             } else {
                resolve({ status: 'invalid-id', msg: `❌ RECHAZADO API: ${data.error}`, dbNote: 'ID Invalido' });
             }
          }
        } catch(e) {
          resolve({ status: 'completed', msg: '✅ APROBADO (API Error Parsing)', dbNote: 'Pedido realizado exitosamente' });
        }
      });
    });
    
    req.on('error', (e) => {
      resolve({ status: 'completed', msg: '✅ APROBADO (API Caída)', dbNote: 'Pedido realizado exitosamente' });
    });
    
    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Iniciar el sistema
startListening();
