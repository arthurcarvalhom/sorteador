'use strict';

/* ADTAG Avenida P1 · Sorteador de números
   Tudo roda no navegador: sorteio sem repetição (Fisher-Yates) + localStorage. */

const CHAVE_ESTADO = 'adtag-sorteador:estado:v1';
const MAX_NUMEROS = 100000;
const DURACAO_ANIMACAO_MS = 1800;

const MENSAGENS = {
  inicioVazio: 'Informe o número inicial.',
  fimVazio: 'Informe o número final.',
  naoInteiro: 'Use apenas números inteiros, sem vírgula ou ponto.',
  intervaloInvalido: 'O número inicial precisa ser menor que o número final.',
  intervaloGrande: `O intervalo pode ter no máximo ${MAX_NUMEROS.toLocaleString('pt-BR')} números.`,
  finalizado: 'Todos os números desse intervalo já foram sorteados.',
  confirmarNovo: 'Tem certeza que deseja iniciar um novo sorteio? O histórico atual será apagado.',
  confirmarLimpar: 'Tem certeza que deseja apagar o sorteio salvo? O histórico será perdido e você voltará à tela inicial.',
  erroSalvar: 'Não foi possível salvar o sorteio neste navegador. Ele continua funcionando, mas não será restaurado ao recarregar a página.',
};

const $ = (id) => document.getElementById(id);

const el = {
  logo: $('logo'),
  logoFallback: $('logoFallback'),
  telaConfig: $('telaConfig'),
  formConfig: $('formConfig'),
  inicio: $('inicio'),
  fim: $('fim'),
  erroConfig: $('erroConfig'),
  telaSorteio: $('telaSorteio'),
  numero: $('numeroSorteado'),
  intervalo: $('intervaloAtual'),
  anuncio: $('anuncio'),
  mensagemFinal: $('mensagemFinal'),
  aviso: $('aviso'),
  contSorteados: $('contSorteados'),
  contRestantes: $('contRestantes'),
  botaoSortear: $('botaoSortear'),
  botaoNovo: $('botaoNovo'),
  botaoLimpar: $('botaoLimpar'),
  historicoVazio: $('historicoVazio'),
  lista: $('listaHistorico'),
  dialogo: $('dialogo'),
  dialogoTitulo: $('dialogoTitulo'),
  dialogoMensagem: $('dialogoMensagem'),
  dialogoConfirmar: $('dialogoConfirmar'),
};

// Estado: { inicio, fim, disponiveis (já embaralhados), sorteados, ultimo }
let estado = null;
let sorteando = false;

/* ---------- Aleatoriedade e algoritmo ---------- */

// Inteiro uniforme em [0, limite). Usa crypto quando disponível, sem viés de módulo.
function inteiroAleatorio(limite) {
  if (window.crypto && window.crypto.getRandomValues) {
    const total = 0x100000000;
    const corte = total - (total % limite);
    const buffer = new Uint32Array(1);
    do {
      window.crypto.getRandomValues(buffer);
    } while (buffer[0] >= corte);
    return buffer[0] % limite;
  }
  return Math.floor(Math.random() * limite);
}

function criarLista(inicio, fim) {
  const lista = [];
  for (let numero = inicio; numero <= fim; numero++) lista.push(numero);
  return lista;
}

// Fisher-Yates: percorre de trás para frente trocando cada posição por uma aleatória até ela.
function embaralharNumeros(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = inteiroAleatorio(i + 1);
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

function criarEstado(inicio, fim) {
  return {
    inicio,
    fim,
    disponiveis: embaralharNumeros(criarLista(inicio, fim)),
    sorteados: [],
    ultimo: null,
  };
}

/* ---------- Persistência (localStorage) ---------- */

function salvarEstado() {
  try {
    localStorage.setItem(
      CHAVE_ESTADO,
      JSON.stringify({ ...estado, restantes: estado.disponiveis.length })
    );
    esconderAviso();
  } catch (erro) {
    mostrarAviso(MENSAGENS.erroSalvar);
  }
}

// Confere se os dados salvos estão íntegros: todos os números do intervalo, sem repetição.
function estadoValido(dados) {
  if (!dados || !Number.isSafeInteger(dados.inicio) || !Number.isSafeInteger(dados.fim)) return false;
  if (dados.inicio >= dados.fim) return false;
  if (!Array.isArray(dados.disponiveis) || !Array.isArray(dados.sorteados)) return false;

  const total = dados.fim - dados.inicio + 1;
  if (total > MAX_NUMEROS || dados.disponiveis.length + dados.sorteados.length !== total) return false;

  const ultimoSorteado = dados.sorteados[dados.sorteados.length - 1];
  if (dados.ultimo !== (ultimoSorteado === undefined ? null : ultimoSorteado)) return false;

  const vistos = new Set();
  for (const lista of [dados.disponiveis, dados.sorteados]) {
    for (const numero of lista) {
      if (!Number.isInteger(numero) || numero < dados.inicio || numero > dados.fim) return false;
      vistos.add(numero);
    }
  }
  return vistos.size === total;
}

function carregarEstado() {
  try {
    const texto = localStorage.getItem(CHAVE_ESTADO);
    if (!texto) return null;
    const dados = JSON.parse(texto);
    if (estadoValido(dados)) {
      return {
        inicio: dados.inicio,
        fim: dados.fim,
        disponiveis: dados.disponiveis,
        sorteados: dados.sorteados,
        ultimo: dados.ultimo,
      };
    }
    localStorage.removeItem(CHAVE_ESTADO);
  } catch (erro) {
    // Dados corrompidos ou localStorage indisponível: começa do zero.
  }
  return null;
}

async function limparEstado() {
  if (!estado || sorteando) return;
  const confirmado = await confirmar({
    titulo: 'Limpar sorteio salvo',
    mensagem: MENSAGENS.confirmarLimpar,
    rotulo: 'Limpar sorteio',
  });
  if (!confirmado) return;

  try {
    localStorage.removeItem(CHAVE_ESTADO);
  } catch (erro) {
    // Sem acesso ao armazenamento: nada a remover.
  }
  estado = null;
  esconderAviso();
  atualizarInterface();
  el.inicio.focus();
}

/* ---------- Validação e início ---------- */

function validarIntervalo() {
  const campos = [
    { campo: el.inicio, vazio: MENSAGENS.inicioVazio },
    { campo: el.fim, vazio: MENSAGENS.fimVazio },
  ];
  const valores = [];

  for (const { campo, vazio } of campos) {
    const texto = campo.value.trim();
    if (campo.validity.badInput) return { erro: MENSAGENS.naoInteiro, campo };
    if (texto === '') return { erro: vazio, campo };
    if (!/^-?\d+$/.test(texto) || !Number.isSafeInteger(Number(texto))) {
      return { erro: MENSAGENS.naoInteiro, campo };
    }
    valores.push(Number(texto));
  }

  const [inicio, fim] = valores;
  if (inicio >= fim) return { erro: MENSAGENS.intervaloInvalido, campo: el.inicio };
  if (fim - inicio + 1 > MAX_NUMEROS) return { erro: MENSAGENS.intervaloGrande, campo: el.fim };
  return { inicio, fim };
}

function limparErroConfig() {
  el.erroConfig.textContent = '';
  el.inicio.removeAttribute('aria-invalid');
  el.fim.removeAttribute('aria-invalid');
}

function iniciarSorteio(evento) {
  evento.preventDefault();
  limparErroConfig();

  const resultado = validarIntervalo();
  if (resultado.erro) {
    el.erroConfig.textContent = resultado.erro;
    resultado.campo.setAttribute('aria-invalid', 'true');
    resultado.campo.focus();
    return;
  }

  estado = criarEstado(resultado.inicio, resultado.fim);
  salvarEstado();
  atualizarInterface();
  el.botaoSortear.focus();
}

/* ---------- Sorteio ---------- */

async function sortearNumero() {
  if (!estado || sorteando) return;
  if (estado.disponiveis.length === 0) {
    mostrarAviso(MENSAGENS.finalizado);
    return;
  }

  sorteando = true;
  esconderAviso();
  definirControlesDesabilitados(true);

  // O número é retirado da lista e salvo ANTES da animação: recarregar a página não repete nem perde nada.
  const numero = estado.disponiveis.pop();
  estado.sorteados.push(numero);
  estado.ultimo = numero;
  salvarEstado();

  await animarSorteio(numero);

  sorteando = false;
  definirControlesDesabilitados(false);
  atualizarInterface();
  anunciarResultado(numero);
  (el.botaoSortear.disabled ? el.botaoNovo : el.botaoSortear).focus();
}

async function novoSorteio() {
  if (!estado || sorteando) return;

  if (estado.sorteados.length > 0) {
    const confirmado = await confirmar({
      titulo: 'Novo sorteio',
      mensagem: MENSAGENS.confirmarNovo,
      rotulo: 'Iniciar novo sorteio',
    });
    if (!confirmado) return;
  }

  estado = criarEstado(estado.inicio, estado.fim);
  salvarEstado();
  atualizarInterface();
  el.botaoSortear.focus();
}

/* ---------- Animação ---------- */

function prefereMovimentoReduzido() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function mostrarNumero(valor) {
  el.numero.textContent = valor;
  el.numero.style.setProperty('--digitos', Math.max(2, String(valor).length));
}

function revelarNumero(valor) {
  el.numero.classList.remove('girando', 'resultado__numero--vazio', 'revelado', 'escondendo');
  mostrarNumero(valor);
  void el.numero.offsetWidth; // reinicia a animação CSS
  el.numero.classList.add('revelado');
  document.querySelector('.resultado').classList.remove('revelando');
  void document.querySelector('.resultado').offsetWidth;
  document.querySelector('.resultado').classList.add('revelando');
}

function esconderNumero() {
  el.numero.classList.remove('girando', 'resultado__numero--vazio', 'revelado');
  el.numero.classList.add('escondendo');
  el.numero.textContent = '';
}

function limparAnimacaoNumero() {
  el.numero.classList.remove('revelado', 'girando', 'escondendo');
  document.querySelector('.resultado').classList.remove('revelando');
}

// Os números que "giram" são só efeito visual; o resultado real já foi definido pela lista embaralhada.
function animarSorteio(numeroFinal) {
  return new Promise((resolve) => {
    if (prefereMovimentoReduzido()) {
      revelarNumero(numeroFinal);
      setTimeout(limparAnimacaoNumero, 700);
      resolve();
      return;
    }

    const amplitude = estado.fim - estado.inicio + 1;
    const comeco = performance.now();
    el.numero.classList.remove('revelado', 'resultado__numero--vazio', 'escondendo');
    el.numero.classList.add('girando');

    const passo = () => {
      const progresso = (performance.now() - comeco) / DURACAO_ANIMACAO_MS;

      if (progresso >= 1) {
        el.numero.classList.remove('girando');
        esconderNumero();
        setTimeout(() => {
          revelarNumero(numeroFinal);
          setTimeout(() => {
            limparAnimacaoNumero();
            resolve();
          }, 1200);
        }, 1200);
        return;
      }

      const numeroEmRodagem = estado.inicio + inteiroAleatorio(amplitude);
      mostrarNumero(numeroEmRodagem);
      const atraso = 120 + 320 * progresso * progresso;
      setTimeout(passo, atraso);
    };

    passo();
  });
}

/* ---------- Interface ---------- */

function formatar(numero) {
  return numero.toLocaleString('pt-BR');
}

function criarChip(numero) {
  const item = document.createElement('li');
  item.className = 'chip';
  item.textContent = numero;
  return item;
}

// Só acrescenta o que falta; reconstrói tudo apenas se a lista estiver fora de sincronia.
function renderizarHistorico() {
  const total = estado.sorteados.length;
  let existentes = el.lista.childElementCount;

  if (existentes > total || existentes < total - 1) {
    el.lista.replaceChildren();
    existentes = 0;
  }

  const fragmento = document.createDocumentFragment();
  for (let i = existentes; i < total; i++) fragmento.append(criarChip(estado.sorteados[i]));
  el.lista.append(fragmento);

  const anterior = el.lista.querySelector('.chip--ultimo');
  if (anterior) anterior.classList.remove('chip--ultimo');
  if (el.lista.lastElementChild) el.lista.lastElementChild.classList.add('chip--ultimo');
}

function atualizarNumeroExibido() {
  el.numero.classList.remove('girando');
  if (estado.ultimo === null) {
    el.numero.classList.remove('revelado');
    el.numero.classList.add('resultado__numero--vazio');
    mostrarNumero('?');
  } else {
    el.numero.classList.remove('resultado__numero--vazio');
    mostrarNumero(estado.ultimo);
  }
}

function atualizarInterface() {
  const emAndamento = estado !== null;
  el.telaConfig.hidden = emAndamento;
  el.telaSorteio.hidden = !emAndamento;
  if (!emAndamento) return;

  const restantes = estado.disponiveis.length;
  const finalizado = restantes === 0;

  atualizarNumeroExibido();
  el.intervalo.textContent = `Intervalo: ${estado.inicio} a ${estado.fim}`;
  el.contSorteados.textContent = formatar(estado.sorteados.length);
  el.contRestantes.textContent = formatar(restantes);
  el.botaoSortear.disabled = finalizado || sorteando;
  el.mensagemFinal.hidden = !finalizado;
  el.historicoVazio.hidden = estado.sorteados.length > 0;
  renderizarHistorico();
}

function definirControlesDesabilitados(desabilitado) {
  el.botaoSortear.disabled = desabilitado;
  el.botaoNovo.disabled = desabilitado;
  el.botaoLimpar.disabled = desabilitado;
}

function anunciarResultado(numero) {
  const restantes = estado.disponiveis.length;
  const fim = restantes === 0 ? ' Todos os números foram sorteados.' : ` Restam ${restantes}.`;
  el.anuncio.textContent = '';
  el.anuncio.textContent = `Número sorteado: ${numero}.${fim}`;
}

function mostrarAviso(texto) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
}

function esconderAviso() {
  el.aviso.hidden = true;
  el.aviso.textContent = '';
}

/* ---------- Confirmação ---------- */

function confirmar({ titulo, mensagem, rotulo }) {
  const dialogo = el.dialogo;
  if (typeof dialogo.showModal !== 'function') {
    return Promise.resolve(window.confirm(mensagem));
  }

  el.dialogoTitulo.textContent = titulo;
  el.dialogoMensagem.textContent = mensagem;
  el.dialogoConfirmar.textContent = rotulo;
  dialogo.returnValue = '';

  return new Promise((resolve) => {
    dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'confirmar'), { once: true });
    dialogo.showModal();
  });
}

/* ---------- Inicialização ---------- */

// Se images/logo.png não existir, mostra um monograma no lugar.
function configurarLogo() {
  const usarReserva = () => {
    el.logo.hidden = true;
    el.logoFallback.hidden = false;
  };
  el.logo.addEventListener('error', usarReserva);
  if (el.logo.complete && el.logo.naturalWidth === 0) usarReserva();
}

function iniciarAplicacao() {
  configurarLogo();

  el.formConfig.addEventListener('submit', iniciarSorteio);
  el.inicio.addEventListener('input', limparErroConfig);
  el.fim.addEventListener('input', limparErroConfig);
  el.botaoSortear.addEventListener('click', sortearNumero);
  el.botaoNovo.addEventListener('click', novoSorteio);
  el.botaoLimpar.addEventListener('click', limparEstado);

  estado = carregarEstado(); // retoma o sorteio salvo, se existir
  atualizarInterface();
}

iniciarAplicacao();
