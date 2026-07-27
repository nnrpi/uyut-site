const DB = "https://uyut-site-default-rtdb.firebaseio.com/uyut";

async function sendMsg(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `chat_id=${chatId}&text=${encodeURIComponent(text)}`
  });
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
    const res = await fetch(`${DB}/products.json`);
    const products = (await res.json()) || [];
    const idx = products.findIndex(p => p.name.trim().toLowerCase() === arg.toLowerCase());
    if (idx === -1) {
      await sendMsg(env, chatId, "Ой, нет такого продукта");
      return;
    }
    await fetch(`${DB}/products/${idx}.json`, { method: "PATCH", body: JSON.stringify({ status: "red" }) });
    await sendMsg(env, chatId, "Упс!");
  } else if (cmd === "/add") {
    if (!arg) return;
    const res = await fetch(`${DB}/products.json`);
    const products = (await res.json()) || [];
    products.push({
      id: "p" + Date.now() + Math.random().toString(36).slice(2, 6),
      name: arg,
      status: "green"
    });
    await fetch(`${DB}/products.json`, { method: "PUT", body: JSON.stringify(products) });
    await sendMsg(env, chatId, `🛒 ${arg} добавлен, статус: Есть.`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    await runCheck(env);
  },
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const update = await request.json();
      const msg = update.message;
      if (msg && msg.text && msg.text.startsWith("/")) {
        await handleCommand(env, msg.chat.id, msg.text);
      }
      return new Response("ok");
    }
    await runCheck(env);
    return new Response("ok");
  }
};
