# 🎱 Sala de Sorteio

Sorteio por **comando de voz** (e por botão) que **não repete números**: você define um
intervalo (ex.: 1 a 20), manda sortear falando, e o app **mostra o número gigante na tela**
e **fala em voz alta** o resultado. Os números sorteados ficam gravados num arquivo JSON,
cada rodada usa cada número apenas uma vez, e quando esgota você reinicia falando.

## Como funciona

- **Voz para ouvir** (`reconhecer`): API de fala do navegador (Chrome/Edge) com `pt-BR`.
- **Voz para falar** (`anunciar`): síntese de fala do navegador com voz `pt-BR`.
- **Backend**: Node.js + Express. Estado central no servidor → várias telas/dispositivos
  mostram o mesmo sorteio.
- **Gravação**: arquivo `data/sorteios.json` (criado sozinho), com o intervalo e o
  histórico completo por rodada.

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
porta interna 3000. O banco/estado fica no volume `./data`. 

## Uso

1. Ajuste o intervalo (Mínimo/Máximo) e clique em **Aplicar**.
2. Clique em **Ativar microfone** (o navegador pede permissão) — ou use o botão **Sortear**.
3. Diga **“sortear”** e veja o globo girar e o número ser revelado e anunciado.
4. Ao esgotar, diga **“reiniciar”** duas vezes (confirmação) para uma nova rodada.

## Detalhes técnicos

- Intervalo válido: de 2 até 100.000 números.
- Sorteio justo: cada draw escolhe uniformemente entre os números ainda não usados
  (criptográfico, `crypto.randomInt`). Alternar de intervalo inicia uma nova rodada.
- `data/sorteios.json`: quando a rodada termina (reset ou troca de intervalo), ela é
  arquivada em `rounds` (até 500 rodadas). Quando roda via Docker, o arquivo é criado
  como `root` (use `sudo` para editá-lo no host).

### API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/state` | Estado atual (intervalo, restantes, histórico, rodadas) |
| POST | `/api/config` `{min,max}` | Define intervalo e inicia nova rodada |
| POST | `/api/draw` | Sorteia o próximo número (409 se esgotado) |
| POST | `/api/reset` | Encerra a rodada atual e inicia nova |

## Estrutura

```
sorteador/
├── server.js                 # Express: API + estática + persistência JSON
├── public/                   # frontend (HTML/CSS/JS, sem dependências)
│   ├── index.html
│   ├── style.css
│   └── app.js                # voz, animações, confetes
├── data/                     # criado em runtime: sorteios.json (+ certs/ no modo HTTPS)
├── Dockerfile
├── docker-compose.yml        # DEFINITIVO (servidor, atrás do Traefik)
└── docker-compose.local.yml  # dev local (Docker, sem Traefik)
```

## Limitações

- Comando de voz exige **Chrome ou Edge** (a API de fala não existe em todos os
  navegadores) e conexão com a internet para o reconhecimento.
- A síntese de fala pode usar a voz `pt-BR` disponível no sistema/Google; se não houver,
  o número ainda aparece grande na tela.
