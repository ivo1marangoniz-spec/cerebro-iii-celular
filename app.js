// Tela do app do celular: capturar ideias, ver as salvas e a situação de cada uma. Tudo local (offline).
(() => {
  const A = window.Armazenamento;
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, texto) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (texto !== undefined) e.textContent = texto;
    return e;
  };
  const lerPref = (k, p = null) => { try { return localStorage.getItem(k) ?? p; } catch { return p; } };
  const gravarPref = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

  const ROTULO = { pendente: 'Pendente', enviada: 'Enviada', 'no-cerebro': 'No cérebro' };
  let ideias = [];
  let filtro = 'todas';
  let aberta = null;    // id da ideia expandida
  let editando = null;  // id da ideia em edição

  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  function mostrarResultado(texto, falha = false) {
    $('resultado').textContent = texto;
    $('resultado').classList.toggle('falha', falha);
  }

  // ---------- captura ----------
  // O rascunho fica guardado enquanto você digita: fechar o app no meio não perde o texto.
  const entrada = $('entrada');
  entrada.value = lerPref('rascunho', '');
  function atualizarContador() {
    const n = entrada.value.length;
    $('contador').textContent = n > A.MAX_TEXTO * 0.8 ? `${n} / ${A.MAX_TEXTO}` : '';
  }
  entrada.addEventListener('input', () => { gravarPref('rascunho', entrada.value || null); atualizarContador(); mostrarResultado(''); });
  atualizarContador();

  async function salvar() {
    const texto = entrada.value;
    const botao = $('btn-salvar');
    botao.disabled = true;
    try {
      await A.salvar(texto);
      // Só limpa se o texto não mudou enquanto salvava.
      if (entrada.value === texto) { entrada.value = ''; gravarPref('rascunho', null); }
      atualizarContador();
      mostrarResultado('Ideia salva neste celular.');
      filtro === 'enviadas' && definirFiltro('todas');
      await carregar();
    } catch (err) {
      mostrarResultado(`Não foi possível salvar: ${err.message} Seu texto continua no campo.`, true);
    }
    botao.disabled = false;
  }
  $('btn-salvar').onclick = salvar;
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar(); } });

  // ---------- lista ----------
  function definirFiltro(f) {
    filtro = f;
    for (const b of document.querySelectorAll('.filtro')) b.classList.toggle('ativo', b.dataset.filtro === f);
    renderLista();
  }
  for (const b of document.querySelectorAll('.filtro')) b.onclick = () => definirFiltro(b.dataset.filtro);

  async function carregar() {
    try {
      ideias = await A.listar();
    } catch (err) {
      mostrarResultado(`Não foi possível ler as ideias deste celular: ${err.message}`, true);
      ideias = [];
    }
    renderLista();
    renderInfo();
  }

  function renderLista() {
    const caixa = $('ideias');
    caixa.replaceChildren();
    const lista = ideias.filter((i) => filtro === 'todas' || (filtro === 'pendente' ? i.situacao === 'pendente' : i.situacao !== 'pendente'));
    if (!lista.length) {
      caixa.append(el('div', 'vazio', filtro === 'todas' ? 'Nenhuma ideia ainda. Escreva a primeira acima.' : 'Nenhuma ideia aqui.'));
    }
    for (const ideia of lista) caixa.append(cartao(ideia));
    const pendentes = ideias.filter((i) => i.situacao === 'pendente').length;
    $('pendentes').hidden = !pendentes;
    $('pendentes').textContent = `${pendentes} pendente${pendentes > 1 ? 's' : ''}`;
  }

  function cartao(ideia) {
    const c = el('article', `ideia${ideia.id === aberta ? ' aberta' : ''}`);
    const cabeca = el('div', 'ideia-cabeca');
    cabeca.append(el('span', 'ideia-quando', quando(ideia.capturado)), el('span', `situacao ${ideia.situacao}`, ROTULO[ideia.situacao] || ideia.situacao));
    c.append(cabeca);

    if (ideia.id === editando) {
      const campo = el('textarea', 'ideia-editar');
      campo.value = ideia.texto;
      const acoes = el('div', 'ideia-acoes');
      const salvarB = el('button', 'botao', 'Salvar');
      const cancelar = el('button', 'botao', 'Cancelar');
      salvarB.onclick = async () => {
        try { await A.editar(ideia.id, campo.value); editando = null; mostrarResultado('Ideia atualizada.'); await carregar(); } catch (err) { mostrarResultado(err.message, true); }
      };
      cancelar.onclick = () => { editando = null; renderLista(); };
      acoes.append(salvarB, cancelar);
      c.append(campo, acoes);
      setTimeout(() => campo.focus(), 0);
      return c;
    }

    c.append(el('div', 'ideia-texto', ideia.texto));
    if (ideia.id === aberta) {
      const acoes = el('div', 'ideia-acoes');
      const copiar = el('button', 'botao', 'Copiar');
      copiar.onclick = async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(ideia.texto); mostrarResultado('Texto copiado.'); } catch { mostrarResultado('Não foi possível copiar.', true); }
      };
      acoes.append(copiar);
      if (ideia.situacao === 'pendente') {
        const editar = el('button', 'botao', 'Editar');
        editar.onclick = (e) => { e.stopPropagation(); editando = ideia.id; renderLista(); };
        const apagar = el('button', 'botao perigo', 'Apagar');
        apagar.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('Apagar esta ideia deste celular? Ela ainda não foi enviada, então será perdida.')) return;
          try { await A.apagar(ideia.id); aberta = null; mostrarResultado('Ideia apagada.'); await carregar(); } catch (err) { mostrarResultado(err.message, true); }
        };
        acoes.append(editar, apagar);
      }
      c.append(acoes);
      if (ideia.editado) c.append(el('div', 'ideia-nota', `Editada em ${quando(ideia.editado)}`));
    }
    c.onclick = () => { aberta = aberta === ideia.id ? null : ideia.id; renderLista(); };
    return c;
  }

  // ---------- aparelho e exportação ----------
  const instalado = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  let persistente = null;

  function renderInfo() {
    const total = ideias.length;
    const pend = ideias.filter((i) => i.situacao === 'pendente').length;
    const partes = [`${total} ideia${total === 1 ? '' : 's'} guardada${total === 1 ? '' : 's'} (${pend} pendente${pend === 1 ? '' : 's'})`];
    partes.push(instalado() ? 'app instalado' : 'aberto no navegador');
    if (persistente === true) partes.push('armazenamento protegido');
    else if (persistente === false) partes.push('armazenamento sem proteção extra');
    $('info-aparelho').textContent = partes.join(' · ');
  }

  // Gera um arquivo Markdown com todas as ideias (cópia de segurança manual).
  async function exportar() {
    if (!ideias.length) { mostrarResultado('Não há ideias para exportar.'); return; }
    const linhas = ['# Ideias do Cérebro III (celular)', '', `Exportado em ${quando(A.isoLocal())}.`, ''];
    for (const i of [...ideias].reverse()) {
      linhas.push(`## ${quando(i.capturado)} (${ROTULO[i.situacao] || i.situacao})`, '', i.texto, '', `<!-- id: ${i.id} -->`, '');
    }
    const nome = `cerebro-iii-ideias-${A.isoLocal().slice(0, 10)}.md`;
    const arquivo = new File([linhas.join('\n')], nome, { type: 'text/markdown' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: 'Ideias do Cérebro III' });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(arquivo);
    const a = el('a');
    a.href = url;
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  $('btn-exportar').onclick = exportar;

  // ---------- aviso de instalação (iPhone) ----------
  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('aviso-instalar').hidden = !(ehIOS && !instalado() && lerPref('aviso-instalar') !== 'fechado');
  $('btn-aviso-fechar').onclick = () => { gravarPref('aviso-instalar', 'fechado'); $('aviso-instalar').hidden = true; };

  // ---------- funcionamento offline (service worker) ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const avisar = (sw) => { if (sw && navigator.serviceWorker.controller) $('atualizacao').hidden = false; };
      if (reg.waiting) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        novo?.addEventListener('statechange', () => { if (novo.state === 'installed') avisar(novo); });
      });
      $('btn-atualizar').onclick = () => { (reg.waiting)?.postMessage('ativar'); };
    }).catch(() => {});
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando) return;
      recarregando = true;
      location.reload(); // o rascunho fica guardado, nada se perde
    });
  }

  // ---------- início ----------
  A.pedirPersistencia().then((p) => { persistente = p; renderInfo(); });
  carregar();
})();
