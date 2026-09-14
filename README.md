# Advance Home

Advance Home é um emulador de Game Boy Advance executado inteiramente no navegador. A interface HOME usa uma biblioteca horizontal inspirada em consoles atuais e não exige framework, build, servidor obrigatório ou dependências baixadas em tempo de execução.

> Projeto para estudo e preservação. A aplicação não fornece ROMs comerciais nem BIOS proprietária. Use somente cópias de jogos obtidas legalmente.

## Como abrir

1. Dê dois cliques em `Iniciar Advance Home.cmd`.
2. A HOME abrirá automaticamente no navegador em `http://127.0.0.1:8765/`.
3. Clique na capa de **Pokémon Emerald**. O jogo será carregado diretamente, sem pedir para selecionar a ROM.
4. Aguarde a inicialização do jogo. A primeira imagem pode levar alguns segundos para aparecer.

Mantenha a pequena janela minimizada do **Advance Home** aberta enquanto estiver jogando. Ao iniciar um jogo, a HOME desaparece e somente a imagem do jogo permanece na tela. A capa fixa usa diretamente o arquivo `Pokemon - Emerald Version (USA, Europe).gba` colocado pelo usuário na raiz do projeto.

O cartucho é processado localmente e não é enviado à internet. O inicializador cria apenas um servidor privado em `127.0.0.1`, acessível pelo próprio computador. Abrir `index.html` diretamente por `file://` não permite que uma página leia automaticamente um arquivo vizinho; nesse modo, use **Adicionar jogo** para outras ROMs.

Como alternativa manual ao inicializador, abra um terminal na pasta e execute:

```text
node local-server.js
```

Depois visite `http://127.0.0.1:8765/`.

### Versão publicada no GitHub Pages

A versão pública não distribui ROMs. Clique em uma capa e escolha no seu dispositivo uma cópia `.gba` obtida legalmente. O jogo é validado, armazenado somente no IndexedDB do navegador e passa a abrir diretamente nas próximas vezes. Nenhum cartucho, save ou estado é enviado ao GitHub ou a qualquer servidor.

## Correção da tela preta

A tela preta era causada por limitações do interpretador ARM/THUMB inicial e por um retorno incorreto da instrução THUMB `BL`, que prendia o Pokémon Emerald em um laço durante o boot. O retorno, as transferências de PSR, o trampoline de IRQ sem BIOS e o estado inicial de `DISPCNT` foram corrigidos no núcleo educacional.

Para compatibilidade real com jogos comerciais, a execução principal agora usa uma cópia local do núcleo livre **GBA.js**, adaptada à interface do Advance Lab. Também foram corrigidos pontos antigos desse núcleo que afetavam navegadores modernos e estados salvos:

- herança não enumerável em `Object.prototype`;
- buffers serializáveis de I/O, palette, VRAM e OAM;
- restauração correta dos registradores de I/O;
- teclado controlado somente pela interface, sem handlers duplicados;
- polling antigo do gamepad desativado para não sobrescrever `KEYINPUT` e anular teclado, toque ou remapeamento;
- persistência de Flash/SRAM e save states no IndexedDB;
- BIOS livre mínima compilada de `vendor/gbajs/bios.S`, sem código proprietário da Nintendo.

## Controles padrão

| GBA | Teclado |
| --- | --- |
| Direcional | Setas |
| A | X |
| B | Z |
| L | A |
| R | S |
| Start | Enter |
| Select | Shift esquerdo |
| Menu rápido | Esc |

Os atalhos podem ser remapeados em **Configurações → Controles**. Os botões visuais aceitam mouse e toque; controles físicos usam a Gamepad API.

### Controle Bluetooth ou USB

1. Abra **Configurações → Controles** no emulador.
2. Clique em **Abrir Bluetooth** para abrir o pareamento do Windows.
3. Depois de emparelhar, pressione qualquer botão no controle e clique em **Detectar controle**.
4. Em **Mapa do controle**, clique na função desejada e pressione um botão ou mova o analógico.

O emulador mostra o nome e o estado do controle, permite escolher entre vários controles conectados e salva o mapeamento no navegador. O layout inicial reconhece tanto o direcional digital quanto o analógico esquerdo. O navegador não realiza sozinho o pareamento Bluetooth de dispositivos HID; o botão abre a tela segura do sistema e a Gamepad API assume depois da conexão.

Na interface, use o direcional ou o analógico para navegar, **A** para confirmar, **B** para voltar e **L/R** para trocar as abas das configurações. Durante o jogo, um toque em **Start** no controle abre o menu rápido; não é mais necessário combinar Start com Select. Todos esses comandos acompanham o remapeamento escolhido pelo usuário.

No teclado, as setas navegam pela HOME, **Enter** confirma e **Esc** volta. Durante o jogo, os atalhos retornam ao mapeamento GBA configurado.

A HOME possui efeitos sonoros originais e discretos para mover, confirmar, voltar, abrir menus e iniciar jogos. Eles são sintetizados localmente pela Web Audio API, sem arquivos de áudio ou sons proprietários, e podem ser desligados em **Configurações → Áudio → Sons do menu**.

### Perfil local

Selecione o botão de perfil rosa na barra inferior ou o avatar no canto superior esquerdo para escolher entre 10 sprites pixel-art fixos. A escolha permanece salva somente neste navegador e apenas o avatar selecionado aparece no canto superior esquerdo.

## Recursos

- Carregamento local e arrastar-e-soltar de ROMs de até 32 MB.
- CPU ARM7TDMI com instruções ARM e THUMB.
- HOME em tela inteira com capas, barra de funções, relógio e status do controle.
- Contador de posição no carrossel, estado vazio guiado e fallback desenhado para jogos sem capa.
- Temas de acento Ciano e Coral selecionáveis em **Configurações → Tela**.
- Perfil local com 10 avatares pixel-art e seleção salva no navegador.
- Efeitos sonoros leves de navegação, gerados localmente pela Web Audio API.
- Jogo isolado em tela cheia, mantendo a proporção original de 240 × 160 sem a antiga carcaça visual.
- Áudio PSG e Direct Sound com controle de volume.
- Teclado remapeável, mouse, toque e gamepad.
- Save Flash/SRAM/EEPROM persistido automaticamente no IndexedDB.
- Cinco save states por jogo.
- Captura PNG, tela cheia e pausa; Pokémon roda em 2× com tom natural, enquanto Zelda e Mario permanecem em 1×.
- Biblioteca recente com miniaturas e ROMs armazenadas apenas no navegador.

## Arquitetura

```text
index.html / style.css
        │
      ui.js ───────────── IndexedDB / localStorage / Gamepad API
        │
 gbajs-adapter.js ─────── contrato da interface, saves, estados e eventos
        │
 vendor/gbajs/js ──────── ARM7TDMI, MMU, IRQ, PPU, áudio e cartucho
        │
  BIOS livre mínima ───── vendor/gbajs/bios.S
```

O primeiro núcleo escrito para o projeto permanece em `js/core/` como implementação educacional e referência, mas não é carregado pela página principal. `js/emulator.js` fornece a camada de armazenamento local e o adaptador substitui seu emulador antigo pelo núcleo compatível.

## Testes

A ROM `Pokemon - Emerald Version (USA, Europe).gba`, colocada localmente na raiz pelo usuário, é usada somente nos testes e não é incorporada ao código.

Validação estática de HTML, referências DOM, arquivos locais e sintaxe JavaScript:

```text
node tests/static-smoke.js
```

Teste do núcleo, renderização e round-trip de estado:

```text
node tests/pokemon-smoke.js
```

Teste da detecção e do remapeamento de controles:

```text
node tests/gamepad-smoke.js
```

Teste da velocidade fixa por jogo (Pokémon em 2×; Zelda e Mario em 1×):

```text
node tests/speed-smoke.js
```

Teste do inicializador e do carregamento direto da ROM local:

```text
node tests/local-server-smoke.js
```

Teste de regressão do FIFA 2006 para timers em cascata e inicialização no navegador:

```text
node tests/fifa-browser-smoke.js
```

Teste visual responsivo da HOME e das configurações no Edge/Chrome:

```text
node tests/layout-browser-smoke.js
```

Teste end-to-end no Microsoft Edge ou Google Chrome instalado:

```text
node tests/browser-smoke.js
```

O teste de navegador abre a página em modo headless, carrega a ROM, espera a tela do jogo, confirma FPS e diversidade de cores, testa teclado, IndexedDB, save state, save Flash e PNG. A evidência visual fica em `tests/pokemon-browser.png`.

Resultado de referência desta correção:

```text
PASS: Pokémon Emerald (BPEE), 361 quadros, 31 cores, save FLASH1M_V
PASS: navegador real; cart=BPEE; colors=16; fps=60; teclado, estado, IndexedDB, save, PNG e file:// OK
```

## Estrutura principal

```text
.
├── index.html
├── style.css
├── README.md
├── Iniciar Advance Home.cmd
├── local-server.js
├── js
│   ├── emulator.js
│   ├── gbajs-adapter.js
│   ├── ui.js
│   └── core/                 núcleo educacional original
├── tests
│   ├── pokemon-smoke.js
│   ├── gamepad-smoke.js
│   ├── speed-smoke.js
│   ├── local-server-smoke.js
│   ├── layout-browser-smoke.js
│   ├── generate-cover.js
│   ├── pokemon-cover.png
│   ├── browser-smoke.js
│   ├── static-smoke.js
│   └── pokemon-browser.png
└── vendor/gbajs
    ├── COPYING
    ├── bios.S
    ├── resources/bios.bin
    └── js/                   núcleo em uso
```

## Compatibilidade e limitações

A compatibilidade ficou muito maior e o Pokémon Emerald fornecido inicia e renderiza normalmente, mas nenhum emulador deve prometer compatibilidade perfeita sem uma suíte extensa de ROMs e comparação com hardware real. Periféricos pouco comuns, link multiplayer, sensores específicos e alguns jogos com timing incomum ainda podem exigir trabalho adicional.

Save states são específicos desta versão do projeto e da mesma ROM.

## Privacidade e armazenamento

ROMs recentes, miniaturas, saves e estados ficam no IndexedDB. Preferências e remapeamento ficam no `localStorage`. Limpar os dados do site pelo navegador remove esse conteúdo local.

## Licença de terceiros

O núcleo GBA.js foi criado por Jeffrey Pfau e é distribuído sob a licença BSD de 2 cláusulas. O texto integral está em `vendor/gbajs/COPYING`. As modificações locais preservam esse aviso.

Game Boy Advance, Pokémon e Nintendo são marcas de seus respectivos proprietários. Advance Lab é independente e não possui afiliação ou endosso desses proprietários.
