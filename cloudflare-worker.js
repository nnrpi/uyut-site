const DB = "https://uyut-site-default-rtdb.firebaseio.com/uyut";
const STATUS_LABELS = { green: "Есть", yellow: "Кончается", red: "ALARM!!!" };

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sendMsg(env, chatId, text) {
  await tg(env, "sendMessage", { chat_id: chatId, text });
}

async function sendKeyboard(env, chatId, text, keyboard) {
  await tg(env, "sendMessage", { chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } });
}

async function editKeyboard(env, chatId, messageId, text, keyboard) {
  await tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });
}

async function answerCallback(env, callbackId, text) {
  await tg(env, "answerCallbackQuery", { callback_query_id: callbackId, text });
}

async function getProducts() {
  const res = await fetch(`${DB}/products.json`);
  return (await res.json()) || [];
}

async function runCheck(env) {
  const res = await fetch(`${DB}.json`);
  const dataRoot = (await res.json()) || {};
  const meta = dataRoot._notifyMeta || {};

  const now = new Date();
  const moscow = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3
  const today = moscow.toISOString().slice(0, 10);
  const day = moscow.getUTCDate();

  let plants = dataRoot.plants || [];
  let lastFlip = meta.lastFlipDate || "";

  if ((day === 1 || day === 15) && lastFlip !== today) {
    plants = plants.map(p => p.id === "succulent" ? { ...p, status: "red" } : p);
    await fetch(`${DB}/plants.json`, { method: "PUT", body: JSON.stringify(plants) });
    await sendMsg(env, env.TELEGRAM_CHAT_ID, "🌵 Суккулент пора полить!");
    lastFlip = today;
  }

  const prevPlants = meta.plantStatuses || {};
  for (const pl of plants) {
    const old = prevPlants[pl.id];
    if (old && old !== pl.status && pl.status === "green") {
      let watered = "полит";
      if (pl.label == "Драцена") {
        watered = "полита";
      }
      await sendMsg(env, env.TELEGRAM_CHAT_ID, `💧 ${pl.label} ${watered}!`);
    }
  }
  const newPlantStatuses = {};
  plants.forEach(pl => { newPlantStatuses[pl.id] = pl.status; });

  const products = dataRoot.products || [];
  const prevProducts = meta.productStatuses || {};
  for (const p of products) {
    const old = prevProducts[p.id];
    if (old && old !== p.status) {
      if (p.status === "yellow") await sendMsg(env, env.TELEGRAM_CHAT_ID, `🟡 ${p.name} кончается!`);
      else if (p.status === "green") await sendMsg(env, env.TELEGRAM_CHAT_ID, `🟢 ${p.name} снова есть!`);
    }
  }
  const newProductStatuses = {};
  products.forEach(p => { newProductStatuses[p.id] = p.status; });

  await fetch(`${DB}/_notifyMeta.json`, {
    method: "PUT",
    body: JSON.stringify({
      lastFlipDate: lastFlip,
      plantStatuses: newPlantStatuses,
      productStatuses: newProductStatuses
    })
  });
}

async function handleCommand(env, chatId, text) {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();

  if (cmd === "/finish") {
    if (!arg) return;
    const products = await getProducts();
    const idx = products.findIndex(p => p.name.trim().toLowerCase() === arg.toLowerCase());
    if (idx === -1) {
      await sendMsg(env, chatId, "Ой, нет такого продукта");
      return;
    }
    await fetch(`${DB}/products/${idx}.json`, { method: "PATCH", body: JSON.stringify({ status: "red" }) });
    await sendMsg(env, chatId, "Упс!");
  } else if (cmd === "/add") {
    if (!arg) return;
    const products = await getProducts();
    products.push({
      id: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
      name: arg,
      status: "green"
    });
    await fetch(`${DB}/products.json`, { method: "PUT", body: JSON.stringify(products) });
    await sendMsg(env, chatId, `🛒 ${arg} добавлен, статус: Есть.`);
  } else if (cmd === "/prod") {
    const products = await getProducts();
    if (!products.length) {
      await sendMsg(env, chatId, "Продуктов пока нет");
      return;
    }
    const keyboard = [];
    for (let i = 0; i < products.length; i += 2) {
      const row = [products[i], products[i + 1]].filter(Boolean).map(p => ({
        text: `${p.emoji || "📦"} ${p.name}`,
        callback_data: `p|${p.id}`
      }));
      keyboard.push(row);
    }
    await sendKeyboard(env, chatId, "Выбери продукт:", keyboard);
  }
}

async function handleCallback(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const [type, ...parts] = cq.data.split("|");

  if (type === "p") {
    const id = parts[0];
    const products = await getProducts();
    const prod = products.find(p => p.id === id);
    if (!prod) {
      await answerCallback(env, cq.id, "Продукт не найден");
      return;
    }
    const keyboard = [
      [{ text: "🟢 Есть", callback_data: `s|${id}|green` }],
      [{ text: "🟡 Кончается", callback_data: `s|${id}|yellow` }],
      [{ text: "🔴 ALARM!!!", callback_data: `s|${id}|red` }]
    ];
    await editKeyboard(env, chatId, messageId, `${prod.emoji || "📦"} ${prod.name} — выбери статус:`, keyboard);
    await answerCallback(env, cq.id);
  } else if (type === "s") {
    const [id, status] = parts;
    const products = await getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) {
      await answerCallback(env, cq.id, "Продукт не найден");
      return;
    }
    await fetch(`${DB}/products/${idx}.json`, { method: "PATCH", body: JSON.stringify({ status }) });
    await editKeyboard(env, chatId, messageId, `${products[idx].emoji || "📦"} ${products[idx].name} — статус: ${STATUS_LABELS[status]}`, null);
    await answerCallback(env, cq.id, "Обновлено");
  }
}

export default {
  async scheduled(event, env, ctx) {
    await runCheck(env);
  },
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const update = await request.json();
      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message && update.message.text && update.message.text.startsWith("/")) {
        await handleCommand(env, update.message.chat.id, update.message.text);
      }
      return new Response("ok");
    }
    await runCheck(env);
    return new Response("ok");
  }
};
