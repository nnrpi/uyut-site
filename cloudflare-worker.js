const DB = "https://uyut-site-default-rtdb.firebaseio.com/uyut";
const STATUS_LABELS = { green: "Есть", yellow: "Кончается", red: "ALARM!!!" };
const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "добавить продукт" }, { text: "закончился" }, { text: "всё" }],
    [{ text: "что купить" }, { text: "купил" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sendMsg(env, chatId, text) {
  await tg(env, "sendMessage", { chat_id: chatId, text, reply_markup: MAIN_KEYBOARD });
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

async function getState(chatId) {
  const res = await fetch(`${DB}/_botState/${chatId}.json`);
  return await res.json();
}

async function setState(chatId, mode) {
  await fetch(`${DB}/_botState/${chatId}.json`, { method: "PUT", body: JSON.stringify(mode) });
}

async function clearState(chatId) {
  await fetch(`${DB}/_botState/${chatId}.json`, { method: "DELETE" });
}

async function getSelection(chatId) {
  const res = await fetch(`${DB}/_buySelection/${chatId}.json`);
  return (await res.json()) || [];
}

async function setSelection(chatId, ids) {
  await fetch(`${DB}/_buySelection/${chatId}.json`, { method: "PUT", body: JSON.stringify(ids) });
}

async function clearSelection(chatId) {
  await fetch(`${DB}/_buySelection/${chatId}.json`, { method: "DELETE" });
}

function boughtKeyboard(products, selected) {
  const keyboard = products.map(p => [{
    text: `${selected.includes(p.id) ? "✅" : "⬜"} ${p.emoji || "📦"} ${p.name}`,
    callback_data: `b|${p.id}`
  }]);
  keyboard.push([{ text: "Готово", callback_data: "bdone" }]);
  return keyboard;
}

function productKeyboard(products, prefix) {
  const keyboard = [];
  for (let i = 0; i < products.length; i += 2) {
    const row = [products[i], products[i + 1]].filter(Boolean).map(p => ({
      text: `${p.emoji || "📦"} ${p.name}`,
      callback_data: `${prefix}|${p.id}`
    }));
    keyboard.push(row);
  }
  return keyboard;
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

async function addProduct(env, chatId, name) {
  const products = await getProducts();
  products.push({
    id: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
    name,
    status: "green"
  });
  await fetch(`${DB}/products.json`, { method: "PUT", body: JSON.stringify(products) });
  await sendMsg(env, chatId, `🛒 ${name} добавлен, статус: Есть.`);
}

async function finishByName(env, chatId, name) {
  const products = await getProducts();
  const idx = products.findIndex(p => p.name.trim().toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    await sendMsg(env, chatId, "Ой, нет такого продукта");
    return;
  }
  await fetch(`${DB}/products/${idx}.json`, { method: "PATCH", body: JSON.stringify({ status: "red" }) });
  await sendMsg(env, chatId, "Упс!");
}

async function showBuyList(env, chatId) {
  const products = await getProducts();
  const need = products.filter(p => p.status === "yellow" || p.status === "red");
  if (!need.length) {
    await sendMsg(env, chatId, "Всё есть, покупать ничего не надо! 🎉");
    return;
  }
  const lines = need.map(p => {
    const icon = p.status === "red" ? "🔴" : "🟡";
    return `${icon} ${p.emoji || "📦"} ${p.name} — ${STATUS_LABELS[p.status]}`;
  });
  await sendMsg(env, chatId, `Что купить:\n${lines.join("\n")}`);
}

async function cmdFinish(env, chatId, arg) {
  if (arg) {
    await clearState(chatId);
    await finishByName(env, chatId, arg);
    return;
  }
  const products = await getProducts();
  if (!products.length) {
    await sendMsg(env, chatId, "Продуктов пока нет");
    return;
  }
  await sendKeyboard(env, chatId, "Какой продукт закончился?", productKeyboard(products, "f"));
}

async function cmdAdd(env, chatId, arg) {
  if (arg) {
    await clearState(chatId);
    await addProduct(env, chatId, arg);
    return;
  }
  await setState(chatId, "add");
  await sendMsg(env, chatId, "Напиши название продукта для добавления:");
}

async function cmdProd(env, chatId) {
  await clearState(chatId);
  const products = await getProducts();
  if (!products.length) {
    await sendMsg(env, chatId, "Продуктов пока нет");
    return;
  }
  await sendKeyboard(env, chatId, "Выбери продукт:", productKeyboard(products, "p"));
}

async function cmdBought(env, chatId) {
  await clearState(chatId);
  const products = await getProducts();
  if (!products.length) {
    await sendMsg(env, chatId, "Продуктов пока нет");
    return;
  }
  await clearSelection(chatId);
  await sendKeyboard(env, chatId, "Что купил(а)? Отметь и жми «Готово»:", boughtKeyboard(products, []));
}

async function handleCommand(env, chatId, text) {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();

  if (cmd === "/finish") await cmdFinish(env, chatId, arg);
  else if (cmd === "/add") await cmdAdd(env, chatId, arg);
  else if (cmd === "/prod") await cmdProd(env, chatId);
  else if (cmd === "/buy") { await clearState(chatId); await showBuyList(env, chatId); }
  else if (cmd === "/bought") await cmdBought(env, chatId);
}

async function handleText(env, chatId, text) {
  const t = text.trim().toLowerCase();
  if (t === "что купить") { await showBuyList(env, chatId); return; }
  if (t === "добавить продукт") { await cmdAdd(env, chatId, ""); return; }
  if (t === "закончился") { await cmdFinish(env, chatId, ""); return; }
  if (t === "всё") { await cmdProd(env, chatId); return; }
  if (t === "купил") { await cmdBought(env, chatId); return; }

  const state = await getState(chatId);
  if (state === "add") {
    await clearState(chatId);
    await addProduct(env, chatId, text.trim());
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
      [{ text: "🔴 ALARM!!!", callback_data: `s|${id}|red` }],
      [{ text: "🗑️ Убрать из списка", callback_data: `d|${id}` }]
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
  } else if (type === "d") {
    const id = parts[0];
    const products = await getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) {
      await answerCallback(env, cq.id, "Продукт не найден");
      return;
    }
    const removed = products[idx];
    products.splice(idx, 1);
    await fetch(`${DB}/products.json`, { method: "PUT", body: JSON.stringify(products) });
    await editKeyboard(env, chatId, messageId, `${removed.emoji || "📦"} ${removed.name} убран из списка.`, null);
    await answerCallback(env, cq.id, "Убрано");
  } else if (type === "b") {
    const id = parts[0];
    const products = await getProducts();
    let selected = await getSelection(chatId);
    if (selected.includes(id)) selected = selected.filter(x => x !== id);
    else selected = [...selected, id];
    await setSelection(chatId, selected);
    await editKeyboard(env, chatId, messageId, "Что купил(а)? Отметь и жми «Готово»:", boughtKeyboard(products, selected));
    await answerCallback(env, cq.id);
  } else if (type === "bdone") {
    const selected = await getSelection(chatId);
    if (!selected.length) {
      await answerCallback(env, cq.id, "Ничего не выбрано");
      return;
    }
    const products = await getProducts();
    const boughtNames = [];
    const updated = products.map(p => {
      if (selected.includes(p.id)) {
        boughtNames.push(p.name);
        return { ...p, status: "green" };
      }
      return p;
    });
    await fetch(`${DB}/products.json`, { method: "PUT", body: JSON.stringify(updated) });
    await clearSelection(chatId);
    await editKeyboard(env, chatId, messageId, `Куплено: ${boughtNames.join(", ")}. Статус: Есть.`, null);
    await answerCallback(env, cq.id, "Готово!");
  } else if (type === "f") {
    const id = parts[0];
    const products = await getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) {
      await answerCallback(env, cq.id, "Продукт не найден");
      return;
    }
    await fetch(`${DB}/products/${idx}.json`, { method: "PATCH", body: JSON.stringify({ status: "red" }) });
    await editKeyboard(env, chatId, messageId, `${products[idx].emoji || "📦"} ${products[idx].name} — статус: ALARM!!!`, null);
    await answerCallback(env, cq.id, "Упс!");
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
      } else if (update.message && update.message.text) {
        const text = update.message.text;
        if (text.startsWith("/")) {
          await handleCommand(env, update.message.chat.id, text);
        } else {
          await handleText(env, update.message.chat.id, text);
        }
      }
      return new Response("ok");
    }
    await runCheck(env);
    return new Response("ok");
  }
};
