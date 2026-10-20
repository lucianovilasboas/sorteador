# 🎱 Sala de Sorteio

Sorteio por **comando de voz** (e por botão) que **não repete números**: você define um
intervalo (ex.: 1 a 20), manda sortear falando, e o app **mostra o número gigante na tela**
e **fala em voz alta** o resultado. Cada rodada usa cada número apenas uma vez, e quando
esgota você reinicia falando.

## Como funciona

- **Voz para ouvir** (`reconhecer`): API de fala do navegador (Chrome/Edge) com `pt-BR`.
- **Voz para falar** (`anunciar`): síntese de fala do navegador com voz `pt-BR`.
- **Silenciar**: o botão `🔊` ao lado do indicador do microfone desliga **só a voz de
  saída** — o número continua sendo sorteado e aparece na tela. O estado fica salvo no
  navegador (`sorteador.muted`).
- **Single Page Application**: o app roda inteiro no navegador. **Não há backend de dados
  nem API** — o servidor Node só entrega os arquivos estáticos.
- **Gravação**: `localStorage` do navegador, chave `sorteador.state.v1` (intervalo, rodada
  atual e as **20 últimas rodadas**). O sorteio funciona **offline**.

### Comandos de voz

| Você diz | Acontece |
| --- | --- |
| “Sortear”, “Sorteia”, “Próximo”, “Gira” | Sorteia o próximo número **não usado** |
| “Reiniciar”, “Zerar”, “Recomeçar” | Arma a nova rodada (peça de novo para confirmar) |

## Como rodar

Há dois arquivos Docker Compose no projeto:

- **`docker-compose.yml`** — definitivo, para o servidor atrás do proxy reverso
  (Traefik). Sem HTTPS próprio; o certificado é emitido pelo Traefik.
- **`docker-compose.local.yml`** — para desenvolvimento/teste local nesta máquina
  (sem Traefik).

### Dev local — direto no Node (voz no próprio PC)

```bash
npm install
npm start
# abra http://localhost:3000
```

> Acessar por **`localhost`** já é tratado como ambiente seguro pelo navegador, então o
> reconhecimento de voz funciona direto.

### Dev local — Docker

```bash
docker compose -f docker-compose.local.yml up -d
# abra http://localhost:3200
```

Para usar a voz de celular/TV na rede local (precisa HTTPS; certificado auto-assinado):

```bash
docker compose -f docker-compose.local.yml --profile https up -d
# abra https://<ip-da-máquina>:3443  e aceite o aviso do certificado
```

### Definitivo — servidor com Traefik (produção)

```bash
docker compose up -d --build
# domínio: https://sorteador.lucianovilasboas.com.br
```

O container entra apenas na rede externa `proxy` (do Traefik); o proxy encaminha para a
porta interna 3000. O volume `./data` serve apenas para guardar os certificados
auto-assinados do modo HTTPS — o estado dos sorteios **não** fica no servidor.

## Uso

1. Ajuste o intervalo (Mínimo/Máximo) e clique em **Aplicar**.
2. Clique em **Ativar microfone** (o navegador pede permissão) — ou use o botão **Sortear**.
3. Diga **“sortear”** e veja o globo girar e o número ser revelado e anunciado.
4. Ao esgotar, diga **“reiniciar”** duas vezes (confirmação) para uma nova rodada.

## Histórico: backup

Como os dados moram no navegador, limpar os dados do site apaga o histórico. Há dois
atalhos (sem nenhum botão na tela):

- **`Ctrl+Alt+E`** — baixa um `sorteios-AAAA-MM-DD.json` com o estado completo.
- **`Ctrl+Alt+I`** — lê esse arquivo e substitui a rodada atual e o histórico.

Use isso para backup, para levar o histórico para outra máquina ou para trocar de
navegador.

## Detalhes técnicos

- Intervalo válido: de 2 até 100.000 números.
- Sorteio justo: cada draw escolhe uniformemente entre os números ainda não usados, via
  `crypto.getRandomValues` com rejeição de cauda (sem viés de módulo). Alternar de
  intervalo inicia uma nova rodada.
- `localStorage`: a rodada encerrada é arquivada (até **20 rodadas**). Se o estado passar
  de ~4 MB, as rodadas mais antigas são descartadas; se o navegador recusar a gravação,
  o app avisa em vez de perder o sorteio em silêncio.
- Abrir o app em duas abas mantém as duas sincronizadas (evento `storage`).
- No celular a tela ocupa exatamente a altura do aparelho (sem rolagem vertical); o
  histórico rola dentro do próprio painel.
- Testes do domínio: `npm test` (Node ≥ 18, sem dependências).

### Estrutura

```
sorteador/
├── server.js                 # Node/Express: serve public/ (+ HTTPS auto-assinado opcional)
├── public/                   # frontend (HTML/CSS/JS, sem dependências)
│   ├── index.html
│   ├── style.css
│   ├── store.js              # domínio do sorteio + localStorage (sem DOM)
│   └── app.js                # voz, animações, confetes, UI
├── test/store.test.js        # testes do store (node:test)
├── data/                     # runtime: apenas certs/ no modo HTTPS
├── Dockerfile
├── docker-compose.yml        # DEFINITIVO (servidor, atrás do Traefik)
└── docker-compose.local.yml  # dev local (Docker, sem Traefik)
```

## Limitações

- Comando de voz exige **Chrome ou Edge** (a API de fala não existe em todos os
  navegadores) e conexão com a internet para o reconhecimento.
- A síntese de fala pode usar a voz `pt-BR` disponível no sistema/Google; se não houver,
  o número ainda aparece grande na tela.
- **O estado é por navegador e por origem.** Outro dispositivo, outro navegador ou outra
  porta/domínio começam do zero; não há sorteio compartilhado entre telas. Para preservar
  o histórico, use **`Ctrl+Alt+E`** para exportar.
- `localStorage` é isolado por origem: `http://localhost:3200` e
  `https://sorteador.lucianovilasboas.com.br` são históricos diferentes.
