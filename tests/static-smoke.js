"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "js", "ui.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "js", "gbajs-adapter.js"), "utf8");
const coreAudio = fs.readFileSync(path.join(root, "vendor", "gbajs", "js", "audio.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const localServer = fs.readFileSync(path.join(root, "local-server.js"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
const scriptPaths = scriptSources.map((source) => source.split(/[?#]/, 1)[0]);

assert.ok(scriptSources.length >= 10, "lista de scripts inesperadamente curta");
for (const [index, source] of scriptSources.entries()) {
  assert.ok(!/^https?:/i.test(source), `dependência externa inesperada: ${source}`);
  assert.ok(fs.existsSync(path.join(root, scriptPaths[index])), `script ausente: ${source}`);
}
assert.ok(scriptPaths.indexOf("js/emulator.js") < scriptPaths.indexOf("vendor/gbajs/js/gba.js"), "ordem incorreta do armazenamento");
assert.ok(scriptPaths.indexOf("vendor/gbajs/js/gba.js") < scriptPaths.indexOf("js/gbajs-adapter.js"), "adaptador carregado antes do núcleo");
assert.equal(scriptPaths.at(-1), "js/ui.js", "ui.js deve inicializar por último");
assert.match(html, /<title>GBAOne<\/title>/, "o título público do emulador não foi renomeado");
assert.match(html, /name="application-name" content="GBAOne"/, "o nome do aplicativo não foi definido");
assert.equal((html.match(/GBAONE/g) || []).length, 2, "o nome GBAOne deve aparecer no menu rápido e nas configurações");
assert.doesNotMatch(`${html}\n${readme}\n${localServer}`, /Advance Home|ADVANCE HOME/, "o nome público antigo ainda aparece no projeto");
assert.match(ui, /window\.gbaOne = emulator/, "a API pública do emulador não usa o novo nome");
assert.doesNotMatch(ui, /advanceLab|advance-lab-link/, "a interface ainda expõe integrações com o nome antigo");
assert.match(html, /class="software-strip"/, "biblioteca horizontal de jogos não foi encontrada");
assert.match(html, /class="system-dock"/, "barra inferior de funções não foi encontrada");
assert.match(html, /class="system-dock"[\s\S]*class="selected-software-copy"/, "o nome selecionado deve aparecer abaixo da barra como no Switch 2");
assert.match(css, /\.home-view\s*{[^}]*grid-template-rows/s, "menu HOME não possui layout de tela inteira");
assert.match(css, /#screen\s*{[^}]*width:\s*min\(100vw,\s*150vh\)[^}]*height:\s*min\(100vh,\s*66\.6667vw\)/s, "jogo não ocupa a tela mantendo 3:2");
assert.match(html, /Select abre este menu/, "atalho de Select para o menu não está documentado na interface");
assert.match(ui, /const menuButton = Boolean\(activeControls\.get\("SELECT"\)\)/, "Select sozinho não abre o menu durante o jogo");
assert.doesNotMatch(ui, /const menuButton = Boolean\(activeControls\.get\("START"\)\)/, "Start ainda abre o menu durante o jogo");
assert.match(ui, /control === "SELECT" && emulator\.romLoaded[\s\S]*?toggleQuickMenu\(true\)/, "a tecla mapeada como Select não abre o menu durante o jogo");
assert.match(css, /html,\s*body\s*{[^}]*overflow:\s*hidden/s, "a barra externa da página não foi removida");
assert.doesNotMatch(html, /class="shell"|class="screen-zone"|class="controls-zone"/, "a carcaça antiga ainda está na interface");
assert.doesNotMatch(ui, /LOCAL_GAMES|loadLocalGame|requestLocalROM|pendingLocalGame|IS_GITHUB_PAGES/, "a HOME ainda possui jogos ou atalhos fixos");
for (const cover of [
  "capas/PokemonEmeraldBox.jpg",
  "capas/MV5BMDY1ZmVkMmQtOWY0Ni00NjZlLTg5NjktYjZhY2YzNTZmYjljXkEyXkFqcGc@._V1_.jpg",
  "capas/firered.jpg",
  "capas/The_Legend_of_Zelda_The_Minish_Cap_capa.png"
]) {
  assert.ok(fs.existsSync(path.join(root, cover)), `capa ausente: ${cover}`);
  assert.ok(ui.includes(cover), `capa não foi mapeada na biblioteca: ${cover}`);
}
assert.match(ui, /function getGameCover\(game\)/, "resolvedor de capas por jogo não foi encontrado");
assert.match(ui, /function createRecentThumbnail\(game\)[\s\S]*?game-cover--fallback[\s\S]*?createElementNS/, "fallback de capa desenhado não foi implementado");
assert.doesNotMatch(ui.match(/function createRecentThumbnail\(game\)[\s\S]*?\n  }/)[0], /createElement\("canvas"\)|hsl\(|fillText\(/, "fallback de capa ainda usa canvas e cor aleatória");
assert.match(html, /id="libraryEmptyHint"[^>]*>Arraste uma ROM \.gba aqui ou clique para escolher um arquivo\./, "instrução do estado vazio não foi encontrada");
assert.doesNotMatch(html, /libraryPosition|library-position/, "o contador visual da biblioteca ainda aparece na HOME");
assert.doesNotMatch(ui, /libraryPosition|`\$\{position\} \/ \$\{total\}`/, "a lógica do contador removido ainda está carregada");
assert.doesNotMatch(css, /\.library-position/, "o estilo do contador removido ainda está carregado");
assert.match(ui, /function updateLibraryEmptyState\(gameCount\)[\s\S]*?is-library-empty[\s\S]*?updateLibraryEmptyState\(gameCount\)/, "estado vazio não é aplicado pela biblioteca");
assert.match(css, /\.home-content\.is-library-empty \.software-card--add\s*\{[^}]*width:\s*clamp\(13rem,[^}]*height:\s*clamp\(13rem/s, "card de primeiro jogo não recebe destaque no estado vazio");
assert.doesNotMatch(ui, /LeafGreen|leafgreen|pokemon-leafgreen-version_p5c2/, "LeafGreen ainda aparece na HOME");
assert.match(ui, /HIDDEN_GAME_CODES = new Set\(\["B6WE"\]\)/, "FIFA 2006 nÃ£o foi removido da biblioteca");
assert.match(ui, /\.filter\(\(game\) => game\?\.rom && !isHiddenGame\(game\)\)/, "a HOME deve mostrar somente ROMs realmente salvas no navegador");
assert.match(ui, /const customCover = getGameCover\(game\);[\s\S]*?image\.src = customCover\.src/, "capa personalizada não tem prioridade sobre capturas antigas");
assert.match(css, /img\.game-cover--custom[\s\S]*?object-fit:\s*contain;[\s\S]*?object-position:\s*center;/, "capas personalizadas podem ser deformadas ou cortadas");
assert.doesNotMatch(html, /pokemon-browser\.png/, "a captura da interface antiga ainda é usada como avatar");
assert.match(ui, /async function persistImportedGameDetails\(gameInfo\)/, "os detalhes do jogo importado não são persistidos");
assert.match(ui, /game\.displayTitle = knownCover\?\.title[\s\S]*?game\.cover = knownCover\.src[\s\S]*?database\.put\("games", game\)/, "a capa reconhecida não fica associada ao jogo salvo");
assert.match(ui, /const result = await emulator\.loadROM\(buffer, file\.name, true\);[\s\S]*?persistImportedGameDetails\(result\)/, "a importação não salva jogo e capa na biblioteca");
assert.match(html, /id="selectedGameTitle">Adicionar jogo<[\s\S]*?id="selectedGameMeta">Escolha uma ROM \.gba</, "o estado inicial da HOME ainda anuncia jogos pré-carregados");
assert.match(html, /id="uiSoundToggle"/, "controle dos sons do menu não foi encontrado");
assert.equal((html.match(/class="profile-avatar profile-avatar--primary"/g) || []).length, 1, "deve existir somente um avatar no canto superior esquerdo");
assert.match(html, /id="profileDialog"/, "editor de perfil não foi encontrado");
assert.doesNotMatch(html, /id="profileInput"|Escolher foto|Remover foto/, "o upload de foto ainda aparece no perfil");
assert.doesNotMatch(ui, /createProfileImage|preferences\.profileImage\s*=/, "a lógica antiga de upload ainda está ativa");
assert.equal((html.match(/class="avatar-option(?: is-selected)?"/g) || []).length, 10, "o seletor não oferece exatamente 10 avatares");
assert.match(html, /id="avatarGrid"[^>]*role="radiogroup"/, "a grade de avatares não está acessível como escolha única");
assert.match(ui, /profileAvatar:\s*"verdant-drake"/, "avatar padrão não foi definido");
assert.match(ui, /function applyProfileAvatar\(\)/, "seleção de avatar não é aplicada ao perfil");
assert.match(ui, /delete loaded\.profileImage/, "dados antigos de upload não são removidos na migração");
assert.match(ui, /GAMEPAD_BINDINGS\.findSpatialTarget\([\s\S]*?refs\.avatarOptions\.map/, "avatares não possuem navegação direcional");
const avatarIds = ["verdant-drake", "ember-lynx", "storm-hare", "tide-turtle", "moss-owl", "leaf-spirit", "fairy-lantern", "coral-mole", "sprout-dino", "sun-star"];
for (const id of avatarIds) {
  const relative = `assets/avatars/${id}.png`;
  const filename = path.join(root, relative);
  assert.ok(fs.existsSync(filename), `avatar ausente: ${relative}`);
  assert.ok(html.includes(relative) && ui.includes(relative), `avatar não foi integrado: ${relative}`);
  const png = fs.readFileSync(filename);
  assert.equal(png.readUInt32BE(16), 384, `largura inesperada do avatar ${id}`);
  assert.equal(png.readUInt32BE(20), 384, `altura inesperada do avatar ${id}`);
}
assert.match(ui, /function playUISound\(kind = "confirm"\)/, "efeitos sonoros da interface não foram encontrados");
assert.match(ui, /window\.AudioContext \|\| window\.webkitAudioContext/, "efeitos sonoros não usam a Web Audio API nativa");
assert.match(ui, /const UI_SOUND_PROFILES = Object\.freeze\([\s\S]*?move:[\s\S]*?toggle:[\s\S]*?confirm:[\s\S]*?back:[\s\S]*?open:[\s\S]*?launch:/, "assinatura sonora completa da interface não foi encontrada");
assert.match(ui, /createBiquadFilter\(\)[\s\S]*?createDynamicsCompressor\(\)/, "efeitos da interface não possuem suavização e controle de dinâmica");
assert.match(ui, /uiSoundPlayedAt\.get\(kind\)[\s\S]*?profile\.cooldown/, "repetição rápida do menu ainda pode embolar o áudio");
assert.match(ui, /function scheduleUISoundVoice\([\s\S]*?exponentialRampToValueAtTime\(\.0001, voiceEnd\)/, "envelope suave dos efeitos da interface não foi instalado");
assert.match(ui, /function getUINoiseBuffer\([\s\S]*?getChannelData/, "textura original do clique da interface não foi criada");
assert.match(ui, /function scheduleUISoundTransient\([\s\S]*?type = "bandpass"[\s\S]*?clickEnvelope/, "clique tátil dos efeitos da interface não foi instalado");
assert.match(css, /\.software-strip\s*{[^}]*overflow-x:\s*auto[^}]*scrollbar-width:\s*none/s, "carrossel não rola horizontalmente sem exibir barra");
assert.match(css, /\.settings-layout\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s, "configurações ainda não usam o layout clean horizontal");
assert.doesNotMatch(css, /\.settings-layout\s*{[^}]*grid-template-columns:\s*13rem/s, "a sidebar quadrada antiga ainda está ativa");
assert.match(css, /\.settings-tab\s*{[^}]*border-radius:\s*999px/s, "abas das configurações não são cápsulas");
assert.doesNotMatch(html, /tabAbout|panelAbout|data-tab="about"|>Sobre<|class="about-card"/, "a seção Sobre ainda está presente nas configurações");
assert.doesNotMatch(html, /tabData|panelData|data-tab="data"|>Dados<|data-open-settings="data"|saveInput|exportSaveBtn|importSaveBtn|cheatInput|addCheatBtn|cheatList/, "a seção Dados ainda está presente nas configurações");
assert.doesNotMatch(ui, /bindDataActions|exportSave\(|importSaveFile|renderCheats|addCheat/, "a lógica da seção Dados ainda está carregada");
assert.match(css, /\.switch\s*{[^}]*appearance:\s*none[^}]*border-radius:\s*999px/s, "checkbox quadrado ainda é usado como interruptor");
assert.match(css, /\.settings-panels\s*{[^}]*scrollbar-width:\s*none/s, "barra visual das configurações não foi ocultada");
assert.match(css, /\.quick-panel\s*{[^}]*border-radius:\s*2rem/s, "menu rápido não acompanha os cantos arredondados da HOME");
assert.match(css, /\.system-dock\s*{[^}]*width:\s*min\(68vw,\s*58rem\)[^}]*border-radius:\s*999px/s, "barra principal não segue as proporções do Switch 2");
assert.match(css, /\.system-dock\s*{[^}]*background:\s*var\(--home-bg\)/s, "barra principal não usa a mesma cor do fundo da interface");
assert.match(css, /\.selected-software-copy\s*{[^}]*width:\s*min\(68vw,\s*58rem\)[^}]*margin:[^;]*auto[^}]*overflow:\s*hidden/s, "nome do jogo não está alinhado e contido sob a barra principal");
assert.match(css, /\.selected-software-copy p\s*{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s, "título longo pode vazar da HOME");
assert.match(ui, /function revealNavigationTarget\(element\)[\s\S]*?strip\.scrollLeft = Math\.max[\s\S]*?document\.scrollingElement/, "navegação entre jogos ainda pode deslocar a página inteira");
assert.match(ui, /function pollGamepads\(\)\s*{\s*[\s\S]*?requestAnimationFrame\(pollGamepads\);\s*try\s*{/, "uma falha de interface ainda pode desligar o polling do controle");
assert.match(html, /style\.css\?v=6/, "a folha visual atual não possui invalidação do cache público");
assert.match(html, /js\/ui\.js\?v=10/, "a versão atual da interface não possui invalidação do cache público");
assert.match(html, /id="screenshotBtn"[^>]*hidden/, "ícone da câmera ainda aparece na barra principal");
for (const selector of ["controls", "saves", "audio"]) {
  assert.match(css, new RegExp(`\\.system-button\\[data-open-settings="${selector}"\\]\\s*\\{\\s*--icon-color:`), `ícone sem cor própria: ${selector}`);
}
for (const selector of ["screenshotBtn", "fullscreenBtn", "settingsBtn"]) {
  assert.match(css, new RegExp(`#${selector}\\s*\\{\\s*--icon-color:`), `ícone sem cor própria: ${selector}`);
}
assert.doesNotMatch(css, /\.system-button[^\n]*--icon-color:\s*(?:#8277ed|#ff9e32|#55c96a|#e7b536|#aa78e7|#39c8d7)/i, "dock ainda usa a paleta arco-íris antiga");
assert.match(ui, /settingsPanelScroller\.scrollTop = 0/, "trocar de aba não retorna o conteúdo do menu ao topo");

assert.doesNotMatch(html, /clearRecentBtn|deleteGameDialog|deleteGameConfirmBtn|danger-button/, "a interface ainda exibe controles para excluir jogos");
assert.doesNotMatch(ui, /deleteMode|deleteTargetId|deleteGameDialog|confirmDeleteGame|moveDeleteTarget/, "a logica de exclusao de jogos ainda esta carregada");
assert.doesNotMatch(css, /is-delete-mode|is-delete-target|delete-game-dialog|danger-button|--danger:/, "os estilos de exclusao de jogos ainda estao presentes");
assert.doesNotMatch(ui, /games\.filter\(\(game\) => game\.code !== "BPEE"\)\.slice\(0, 4\)/, "a biblioteca ainda esconde ROMs antigas da navegacao de exclusao");
assert.doesNotMatch(fs.readFileSync(path.join(root, "js", "emulator.js"), "utf8"), /async deleteGame\(id\)/, "a API de exclusao de jogos ainda esta disponivel");

assert.match(adapter, /apu = \{[\s\S]*?enabled:\s*true/, "audio dos jogos ainda inicia desativado");
assert.match(adapter, /audio\.resampleRatio = audio\.sampleRate \/ outputRate/, "audio nao manteve a taxa e o tom originais");
assert.match(adapter, /audio\.playbackRate = speed;[\s\S]*?audio\.preservePitch = speed > 1;[\s\S]*?audio\.lowLatencyAudio = false/, "compressao temporal sem alterar o tom nao acompanha a velocidade fixa de 2x");
assert.match(adapter, /NORMAL_SPEED_CODE_PREFIXES = Object\.freeze\(\["BZM", "AA2"\]\)/, "Zelda e Mario nao foram classificados para 1x");
assert.match(adapter, /NORMAL_SPEED_NAME_PATTERN = \/\\b\(\?:zelda\|mario\)\\b\/i/, "variantes de Zelda e Mario nao possuem protecao por nome");
assert.match(adapter, /getSpeedMultiplier\(\) \{\s*return this\.isNormalSpeedGame\(\) \? 1 : this\.fastForwardMultiplier;/, "velocidade nao e escolhida por jogo");
assert.match(html, /id="quickSpeedValue">2×<\/span>Velocidade fixa/, "menu rapido nao possui indicador dinamico de velocidade");
assert.match(ui, /function syncGameSpeed\(speed = emulator\.getSpeedMultiplier\(\)\)/, "menu rapido nao sincroniza 1x e 2x");
assert.match(coreAudio, /audioProcessPitchPreserved[\s\S]*?startupSamples[\s\S]*?recoverySkip[\s\S]*?grainConsumption/, "processador de audio com baixa latencia nao foi instalado");
assert.match(coreAudio, /fifoASample = this\.fifoA\.length \? this\.fifoA\.shift\(\) : 0/, "FIFO A ainda pode produzir amostras invalidas");
assert.match(coreAudio, /fifoBSample = this\.fifoB\.length \? this\.fifoB\.shift\(\) : 0/, "FIFO B ainda pode produzir amostras invalidas");
assert.match(adapter, /audio\.outputPointer = audio\.samplePointer;[\s\S]*?audio\.bufferedSamples = 0;[\s\S]*?audio\.pitchState = null;/, "carregar estado ainda reutiliza audio antigo da fila");
assert.match(coreAudio, /maxBufferedSamples = 1 << 23/, "fila expansivel para o atraso do audio nao foi configurada");
assert.match(coreAudio, /growAudioBuffer[\s\S]*?new Float32Array\(newMax\)/, "fila de audio nao cresce para preservar a reproducao em 1x");
assert.doesNotMatch(adapter, /apu\.enabled = false/, "algum fluxo ainda silencia o jogo em 2x");
assert.match(ui, /function onKeyDown\(event\) \{\s*emulator\.apu\.resume\(\)/, "teclado nao desbloqueia o audio do jogo");
assert.match(ui, /document\.addEventListener\("pointerdown", \(\) => \{\s*emulator\.apu\.resume\(\)/, "toque ou clique nao desbloqueia o audio do jogo");
assert.match(html, /class="quick-game-settings"/, "ajustes de jogo nao foram adicionados ao menu rapido");
for (const id of ["quickVolumeRange", "quickFilterSelect", "quickUiSoundToggle"]) {
  assert.match(html, new RegExp(`id="${id}"`), `controle rapido ausente: ${id}`);
}
assert.match(css, /\.console-root:fullscreen[\s\S]*?border:\s*0 !important;[\s\S]*?outline:\s*0 !important;/, "fullscreen ainda permite borda ou outline branco");
assert.match(css, /\.game-display:focus,[\s\S]*?\.game-display:focus-visible[\s\S]*?outline:\s*0 !important;/, "a tela focada ainda pode receber o contorno branco nativo");
assert.match(css, /\.quick-panel\s*{[^}]*max-height:[^}]*overflow-y:\s*auto/s, "menu rapido ampliado pode vazar da tela");
assert.match(ui, /function syncQuickSettings\(\)/, "ajustes rapidos nao sao sincronizados");
assert.match(ui, /quickVolumeRange\.addEventListener\("input"/, "volume rapido nao e funcional");
assert.match(ui, /quickFilterSelect\.addEventListener\("change"/, "filtro rapido nao e funcional");
assert.match(ui, /quickUiSoundToggle\.addEventListener\("change"/, "som da interface nao e funcional no menu rapido");
assert.doesNotMatch(html, /quick-speed-chip|quickBrightnessRange|quickBrightnessValue/, "os controles removidos ainda aparecem no menu rapido");
assert.doesNotMatch(ui, /quickBrightnessRange|quickBrightnessValue/, "a interface ainda referencia o brilho removido do menu rapido");

assert.match(adapter, /restoreState\(state\)[\s\S]*?releaseAllKeys\(\);[\s\S]*?core\.defrost\(state\.frost\);[\s\S]*?releaseAllKeys\(\);/, "carregar estado nao limpa os botoes presos no nucleo");
assert.match(ui, /function resetInputStateAfterRestore\(\)[\s\S]*?previousGamepadControls = activeControls;[\s\S]*?previousMenuButton = Boolean\(activeControls\.get\("SELECT"\)\);/, "controle nao e ressincronizado depois de carregar um estado");
assert.match(ui, /async function loadSlot\(slot\)[\s\S]*?quickMenuOpen = false;[\s\S]*?resetInputStateAfterRestore\(\);[\s\S]*?emulator\.start\(\);/, "carregar estado pelo menu nao devolve o controle ao jogo");

const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, "há IDs HTML duplicados");
const referenceBlock = ui.match(/const ids = \[([\s\S]*?)\];/);
assert.ok(referenceBlock, "lista de referências da interface não encontrada");
const referencedIds = [...referenceBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
for (const id of referencedIds) assert.ok(htmlIds.includes(id), `elemento usado pela UI não existe: #${id}`);

const javascript = [];
for (const directory of ["js", path.join("vendor", "gbajs", "js"), "tests"]) {
  const queue = [path.join(root, directory)];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(filename);
      else if (entry.name.endsWith(".js")) javascript.push(filename);
    }
  }
}
javascript.push(path.join(root, "local-server.js"));
for (const filename of javascript) {
  const checked = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || `sintaxe inválida: ${filename}`);
}

assert.match(css, /\.settings-panels\s*\{[^}]*box-shadow:\s*inset/s, "área rolável das configurações não possui divisor visual");
assert.match(css, /\.settings-tab\.is-active\s*\{[^}]*font-weight:\s*750/s, "aba ativa não possui hierarquia reforçada");
assert.match(html, /id="themeSelect"[^>]*>[\s\S]*?value="indigo">Ciano<[\s\S]*?value="coral">Coral</, "seletor de tema Ciano/Coral não foi exposto");
assert.match(css, /:root\[data-theme="coral"\]\s*\{[^}]*--cyan:\s*#ff9fcf[^}]*--pink:\s*#72e8f3/s, "tema Coral não redefine a paleta principal");
assert.match(ui, /const THEMES = new Set\(\["indigo", "coral"\]\)/, "preferência de tema não é validada");
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.home-content\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s, "HOME mobile ainda deixa o espaço livre abaixo do dock");
assert.match(css, /--transition-fast:\s*120ms[^;]+;[\s\S]*?--transition-medium:\s*220ms/, "tokens de movimento consistentes não foram definidos");
assert.match(css, /--display-font:\s*ui-rounded[^;]+;/, "fonte de destaque offline não foi definida");
assert.match(css, /\.selected-software-copy p\s*\{[^}]*font-family:\s*var\(--display-font\)[^}]*font-weight:\s*800/s, "título do jogo não usa a identidade tipográfica de destaque");
assert.match(css, /\.settings-head h2\s*\{[^}]*font-family:\s*var\(--display-font\)[^}]*font-weight:\s*800/s, "títulos dos diálogos não usam a identidade tipográfica de destaque");
assert.match(css, /\.software-card:active,[\s\S]*?\.quick-grid button:active\s*\{[^}]*scale\(\.97\)/, "feedback tátil de pressionamento não foi aplicado");

assert.ok(fs.existsSync(path.join(root, "vendor", "gbajs", "COPYING")), "licença BSD do núcleo ausente");
assert.ok(fs.existsSync(path.join(root, "Iniciar GBAOne.cmd")), "inicializador de um clique ausente");
const launcher = fs.readFileSync(path.join(root, "Iniciar GBAOne.cmd"), "utf8");
assert.match(launcher, /start "GBAOne"/, "o inicializador ainda usa o nome antigo");
assert.match(launcher, /local-server\.js/, "o inicializador não inicia o servidor local");
assert.match(launcher, /http:\/\/127\.0\.0\.1:8765\//, "o inicializador não abre a HOME no navegador");
console.log(`PASS: HTML íntegro, ${scriptSources.length} scripts locais, ${referencedIds.length} referências DOM e ${javascript.length} arquivos JS válidos`);
