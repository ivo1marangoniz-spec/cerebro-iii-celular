// Tela do app do celular: capturar ideias, ver as salvas e a situação de cada uma. Tudo local (offline).
(() => {
  const A = window.Armazenamento;
  const S = window.Sinc;
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
    botao.setAttribute('aria-busy', 'true');
    try {
      await A.salvar(texto);
      // Só limpa se o texto não mudou enquanto salvava.
      if (entrada.value === texto) { entrada.value = ''; gravarPref('rascunho', null); }
      atualizarContador();
      mostrarResultado('Ideia salva neste celular.');
      filtro === 'enviadas' && definirFiltro('todas');
      await carregar();
      sincronizarAgora(); // se houver internet e a sincronização estiver configurada
    } catch (err) {
      mostrarResultado(`Não foi possível salvar: ${err.message} Seu texto continua no campo.`, true);
    }
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
  $('btn-salvar').onclick = salvar;
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar(); } });

  // ---------- lista ----------
  function definirFiltro(f) {
    filtro = f;
    for (const b of document.querySelectorAll('.lista .filtro')) b.classList.toggle('ativo', b.dataset.filtro === f);
    renderLista();
  }
  for (const b of document.querySelectorAll('.lista .filtro')) b.onclick = () => definirFiltro(b.dataset.filtro);

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
    // Selo no ícone da aba Ideias (número de pendentes)
    $('pendentes').hidden = !pendentes;
    $('pendentes').textContent = pendentes > 99 ? '99+' : String(pendentes);
    document.querySelector('.aba[data-aba="ideias"]').setAttribute('aria-label', pendentes ? `Ideias, ${pendentes} pendente${pendentes > 1 ? 's' : ''}` : 'Ideias');
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
        if (S.ocupado()) { mostrarResultado('Aguarde o envio terminar para salvar a edição.', true); return; }
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
        // Durante um envio a ideia pode estar saindo do aparelho: editar/apagar só depois que terminar.
        const travado = () => { if (!S.ocupado()) return false; mostrarResultado('Aguarde o envio terminar para editar ou apagar.', true); return true; };
        editar.onclick = (e) => { e.stopPropagation(); if (travado()) return; editando = ideia.id; renderLista(); };
        const apagar = el('button', 'botao perigo', 'Apagar');
        apagar.onclick = async (e) => {
          e.stopPropagation();
          if (travado()) return;
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

  // ---------- sincronização ----------
  let ultimoErro = '';
  function renderSinc() {
    const st = $('sinc-status');
    st.classList.remove('erro');
    $('btn-enviar').hidden = !S.configurado();
    $('btn-enviar').disabled = S.ocupado();
    $('btn-enviar').toggleAttribute('aria-busy', S.ocupado());
    $('btn-config').textContent = S.configurado() ? 'Alterar configuração' : 'Configurar sincronização';
    if (!S.configurado()) { st.textContent = 'Sincronização não configurada: as ideias ficam só neste celular.'; return; }
    if (S.ocupado()) { st.textContent = 'Enviando…'; return; }
    if (ultimoErro) { st.textContent = ultimoErro; st.classList.add('erro'); return; }
    const ult = S.ultima();
    st.textContent = !navigator.onLine ? 'Sem internet: as ideias serão enviadas quando a conexão voltar.'
      : ult ? `Sincronizado às ${quando(ult)}` : 'Pronto para enviar.';
  }

  async function sincronizarAgora() {
    if (!S.configurado() || S.ocupado()) { renderSinc(); return; }
    renderSinc();
    const p = S.sincronizar();
    renderSinc(); // mostra "Enviando…"
    const r = await p;
    if (r.offline || r.ignorado || r.semConfig) { renderSinc(); return; }
    ultimoErro = r.erro || '';
    if (r.enviadas || r.noCerebro) mostrarResultado([r.enviadas && `${r.enviadas} ideia(s) enviada(s).`, r.noCerebro && `${r.noCerebro} já no cérebro.`].filter(Boolean).join(' '));
    await carregar();
    renderSinc();
  }
  $('btn-enviar').onclick = sincronizarAgora;
  window.addEventListener('online', sincronizarAgora);
  window.addEventListener('offline', renderSinc);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizarAgora(); });

  // Formulário de configuração. A chave e a senha nunca são mostradas de volta (campos vazios = manter as atuais).
  function abrirConfig(abrir) {
    $('config').hidden = !abrir;
    $('cfg-resultado').textContent = '';
    if (!abrir) return;
    const c = S.config();
    $('cfg-repo').value = c.repo;
    $('cfg-token').value = '';
    $('cfg-senha').value = '';
    $('cfg-senha2').value = '';
    $('cfg-token').placeholder = c.token ? '(guardada; deixe vazio para manter)' : 'github_pat_…';
    $('cfg-senha').placeholder = c.senha ? '(guardada; deixe vazio para manter)' : '';
    $('btn-cfg-remover').hidden = !S.configurado();
  }
  $('btn-config').onclick = () => abrirConfig($('config').hidden);
  $('btn-cfg-cancelar').onclick = () => abrirConfig(false);
  $('config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const atual = S.config();
    const senha = $('cfg-senha').value || atual.senha;
    if ($('cfg-senha').value && $('cfg-senha').value !== $('cfg-senha2').value) { $('cfg-resultado').textContent = 'As senhas não são iguais.'; return; }
    const anterior = { ...atual };
    try {
      S.salvarConfig({ repo: $('cfg-repo').value, token: $('cfg-token').value || atual.token, senha });
      $('cfg-resultado').textContent = 'Testando a conexão…';
      $('btn-cfg-salvar').setAttribute('aria-busy', 'true');
      await S.testar();
      abrirConfig(false);
      ultimoErro = '';
      mostrarResultado('Sincronização configurada.');
      sincronizarAgora();
      carregarMetas();
    } catch (err) {
      // Teste falhou: volta à configuração anterior (se havia) para não deixar o envio quebrado.
      if (anterior.repo && anterior.token && anterior.senha) S.salvarConfig(anterior); else S.apagarConfig();
      $('cfg-resultado').textContent = err.message === 'Failed to fetch' ? 'Sem conexão com o GitHub. Tente de novo com internet.' : err.message;
    }
    $('btn-cfg-salvar').removeAttribute('aria-busy');
    renderSinc();
  });
  $('btn-cfg-remover').onclick = () => {
    if (!confirm('Remover a chave e a senha deste celular? As ideias continuam guardadas aqui.')) return;
    S.apagarConfig();
    abrirConfig(false);
    renderSinc();
  };

  // ---------- aba Metas (resumo que o PC publica trancado; a última versão fica guardada aqui) ----------
  const UM_DIA = 24 * 60 * 60 * 1000;
  let metasAberta = null;   // índice da meta ativa expandida
  let metasErro = '';
  let semPainel = false;
  function barraProgresso(m) {
    const caixa = el('div', 'progresso');
    const barra = el('div', 'progresso-barra');
    const cheia = el('div', 'progresso-cheia');
    cheia.style.width = `${m.total ? Math.round((100 * m.feitas) / m.total) : 0}%`;
    barra.append(cheia);
    caixa.append(barra, el('span', 'progresso-numero', `${m.feitas}/${m.total}`));
    return caixa;
  }
  // Próxima tarefa: tocar mostra os passos do "como fazer" (vindos do computador).
  const passosAbertos = new Set(); // títulos das metas com os passos abertos
  const formatarPassos = (t) => t.replace(/\s+(?=\d+[).]\s)/g, '\n').trim(); // "1) … 2) …" vira uma linha por passo
  const linhaProxima = (m) => {
    if (!m.proxima) return el('div', 'meta-proxima', m.total ? 'Todas as tarefas feitas.' : 'Ainda sem tarefas.');
    const caixa = el('div', 'meta-proxima-caixa');
    const temPassos = !!m.proxima.comoFazer;
    const aberto = passosAbertos.has(m.titulo);
    const linha = el(temPassos ? 'button' : 'div', `meta-proxima${temPassos ? ' com-passos' : ''}`);
    const texto = el('span', 'meta-proxima-texto');
    texto.append(el('span', 'rotulo-suave', 'Próxima: '), document.createTextNode(`${m.proxima.numero}. ${m.proxima.titulo}`));
    linha.append(texto);
    if (temPassos) {
      linha.type = 'button';
      linha.setAttribute('aria-expanded', String(aberto));
      linha.append(el('span', 'passos-dica', aberto ? 'Esconder passos' : 'Ver passos'));
      linha.onclick = (e) => {
        e.stopPropagation();
        if (aberto) passosAbertos.delete(m.titulo); else passosAbertos.add(m.titulo);
        renderMetas();
      };
    }
    caixa.append(linha);
    if (temPassos && aberto) caixa.append(el('div', 'passos', formatarPassos(m.proxima.comoFazer)));
    return caixa;
  };
  function renderMetas() {
    const painel = S.painelGuardado();
    const status = $('metas-atualizado');
    const aviso = $('metas-aviso');
    const caixa = $('metas-conteudo');
    caixa.replaceChildren();
    aviso.hidden = true;
    status.classList.remove('erro');
    $('btn-metas-atualizar').hidden = !S.configurado();
    if (!S.configurado()) {
      status.textContent = '';
      const v = el('div', 'vazio-bloco');
      const ir = el('button', 'botao', 'Abrir Ajustes');
      ir.type = 'button';
      ir.onclick = () => irParaAba('ajustes');
      v.append(el('div', '', 'Configure a sincronização em Ajustes para ver suas metas aqui.'), ir);
      caixa.append(v);
      return;
    }
    status.textContent = painel ? `Atualizado em ${quando(painel.geradoEm)}` : '';
    if (avisoAtualizar) status.textContent = avisoAtualizar;
    if (metasErro) { status.textContent = metasErro; status.classList.add('erro'); }
    if (!painel) {
      caixa.append(el('div', 'vazio-bloco', semPainel
        ? 'O computador ainda não publicou as metas. No app do computador: Configurações → Celular → Ligar metas no celular.'
        : 'Buscando as metas…'));
      return;
    }
    if (Date.now() - Date.parse(painel.geradoEm) > UM_DIA) {
      aviso.textContent = `Pode estar desatualizado: o computador não publica desde ${quando(painel.geradoEm)}.`;
      aviso.hidden = false;
    }
    const foco = painel.metas.find((m) => m.situacao === 'foco');
    const ativas = painel.metas.filter((m) => m.situacao === 'ativa');
    const blocoFoco = el('div', 'meta-foco');
    blocoFoco.append(el('div', 'rotulo-foco', 'Em foco'));
    if (foco) blocoFoco.append(el('div', 'meta-titulo', foco.titulo), barraProgresso(foco), linhaProxima(foco));
    else blocoFoco.append(el('div', 'meta-vazia', 'Nenhuma meta em foco.'));
    caixa.append(blocoFoco, el('h2', 'grupo-titulo-metas', `Ativas${ativas.length ? ` (${ativas.length})` : ''}`));
    if (!ativas.length) { caixa.append(el('div', 'vazio-bloco', 'Nenhuma meta ativa.')); return; }
    const lista = el('div', 'metas-lista');
    ativas.forEach((m, i) => {
      // div com papel de botão: dentro dela fica o botão "Ver passos" (botão dentro de botão não é permitido)
      const item = el('div', `meta-item${metasAberta === i ? ' aberta' : ''}`);
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.setAttribute('aria-expanded', String(metasAberta === i));
      item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.onclick(); } };
      const topo = el('div', 'meta-item-topo');
      topo.append(el('span', 'meta-titulo', m.titulo), el('span', 'meta-seta', '›'));
      item.append(topo, barraProgresso(m));
      if (metasAberta === i) item.append(linhaProxima(m));
      item.onclick = () => { metasAberta = metasAberta === i ? null : i; renderMetas(); };
      lista.append(item);
    });
    caixa.append(lista);
  }
  let buscandoMetas = false;
  let avisoAtualizar = ''; // mensagem do botão Atualizar quando não há nada novo
  async function carregarMetas() {
    if (buscandoMetas) return;
    avisoAtualizar = '';
    buscandoMetas = true;
    $('btn-metas-atualizar').setAttribute('aria-busy', 'true');
    const anterior = S.painelGuardado()?.geradoEm;
    try {
      const r = await S.baixarPainel();
      semPainel = !!r.semPainel;
      if (r.resumo && r.resumo.geradoEm === anterior) avisoAtualizar = `Nada novo: o computador publicou pela última vez em ${quando(anterior)}. Ele publica quando algo muda (e confere a cada 5 minutos enquanto estiver aberto).`;
      metasErro = r.offline ? (S.painelGuardado() ? 'Sem internet: mostrando a última versão guardada.' : 'Sem internet agora. As metas aparecem quando a conexão voltar.') : '';
    } catch (err) {
      metasErro = err.message === 'Failed to fetch' ? 'Sem conexão: mostrando a última versão guardada.' : err.message;
    } finally {
      buscandoMetas = false;
      $('btn-metas-atualizar').removeAttribute('aria-busy');
      renderMetas();
      renderAgendaCel();
    }
  }
  $('btn-metas-atualizar').onclick = carregarMetas;
  $('btn-metas-ideia').onclick = () => { irParaAba('ideias'); entrada.focus(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') carregarMetas(); });
  window.addEventListener('online', carregarMetas);

  // ---------- aba Agenda (do mesmo resumo trancado: hoje e os próximos 6 dias) ----------
  let agendaVista = lerPref('agenda-vista', 'hoje') === 'semana' ? 'semana' : 'hoje';
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dois = (n) => String(n).padStart(2, '0');
  const isoDia = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  const horaDe = (iso) => (iso.length > 10 ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  const diasDe = (e) => {
    if (!e.diaInteiro) return [isoDia(new Date(e.inicio))];
    const out = []; const [a, m, d] = e.inicio.slice(0, 10).split('-').map(Number);
    for (let x = new Date(a, m - 1, d); isoDia(x) < e.fim.slice(0, 10) && out.length < 31; x.setDate(x.getDate() + 1)) out.push(isoDia(x));
    return out.length ? out : [e.inicio.slice(0, 10)];
  };
  function linhaEvento(e) {
    const li = el('div', `agenda-linha${!e.diaInteiro && Date.parse(e.fim) < Date.now() ? ' passou' : ''}`);
    const textos = el('div', 'agenda-linha-textos');
    textos.append(el('div', 'agenda-linha-titulo', e.titulo));
    if (e.local) textos.append(el('div', 'agenda-linha-local', e.local));
    li.append(el('span', 'agenda-linha-hora', e.diaInteiro ? 'dia todo' : horaDe(e.inicio)), textos);
    return li;
  }
  function renderAgendaCel() {
    const painel = S.painelGuardado();
    const caixa = $('agenda-conteudo');
    caixa.replaceChildren();
    for (const b of document.querySelectorAll('.agenda-vistas .filtro')) b.classList.toggle('ativo', b.dataset.vista === agendaVista);
    $('btn-agenda-atualizar').hidden = !S.configurado();
    $('agenda-atualizado').textContent = avisoAtualizar || (painel ? `Atualizado em ${quando(painel.geradoEm)}` : '');
    if (!S.configurado()) { caixa.append(el('div', 'vazio-bloco', 'Configure a sincronização em Ajustes para ver a agenda aqui.')); return; }
    if (!painel) { caixa.append(el('div', 'vazio-bloco', 'Buscando a agenda…')); return; }
    if (!painel.agenda) { caixa.append(el('div', 'vazio-bloco', 'O Google Agenda não está ligado no computador (Configurações → Google Agenda).')); return; }
    const porDia = new Map();
    for (const e of painel.agenda) for (const d of diasDe(e)) { if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(e); }
    const hoje = new Date();
    const dias = agendaVista === 'hoje' ? [hoje] : Array.from({ length: 7 }, (_, i) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i));
    for (const d of dias) {
      const evs = porDia.get(isoDia(d)) || [];
      const nome = `${d.toDateString() === hoje.toDateString() ? 'Hoje · ' : ''}${DIAS[d.getDay()]}, ${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
      caixa.append(el('h2', `agenda-dia${d.toDateString() === hoje.toDateString() ? ' hoje' : ''}`, nome));
      if (!evs.length) { caixa.append(el('div', 'agenda-livre', agendaVista === 'hoje' ? 'Nada na agenda hoje.' : 'Livre')); continue; }
      const lista = el('div', 'metas-lista');
      [...evs.filter((e) => e.diaInteiro), ...evs.filter((e) => !e.diaInteiro)].forEach((e) => lista.append(linhaEvento(e)));
      caixa.append(lista);
    }
  }
  for (const b of document.querySelectorAll('.agenda-vistas .filtro')) b.onclick = () => { agendaVista = b.dataset.vista; gravarPref('agenda-vista', agendaVista); renderAgendaCel(); };
  $('btn-agenda-atualizar').onclick = carregarMetas;

  // ---------- abas (barra flutuante) e botão de nova ideia ----------
  function irParaAba(nome) {
    if (!['metas', 'agenda', 'ideias', 'ajustes'].includes(nome)) nome = 'metas';
    for (const s of document.querySelectorAll('.aba-tela')) s.hidden = s.id !== `aba-${nome}`;
    for (const b of document.querySelectorAll('.aba')) {
      const ativa = b.dataset.aba === nome;
      b.classList.toggle('ativa', ativa);
      if (ativa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    gravarPref('aba', nome);
    window.scrollTo(0, 0);
  }
  for (const b of document.querySelectorAll('.aba')) b.onclick = () => irParaAba(b.dataset.aba);
  $('btn-nova').onclick = () => { irParaAba('ideias'); entrada.focus(); };
  irParaAba(lerPref('aba', 'metas'));

  // ---------- aviso de instalação (iPhone) ----------
  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('aviso-instalar').hidden = !(ehIOS && !instalado() && lerPref('aviso-instalar') !== 'fechado');
  $('btn-aviso-fechar').onclick = () => { gravarPref('aviso-instalar', 'fechado'); $('aviso-instalar').hidden = true; };

  // ---------- funcionamento offline (service worker) ----------
  if ('serviceWorker' in navigator) {
    // Na primeira visita não há versão anterior: ativar o modo offline não deve recarregar a tela.
    const tinhaVersao = !!navigator.serviceWorker.controller;
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
      if (recarregando || !tinhaVersao) return;
      recarregando = true;
      location.reload(); // o rascunho fica guardado, nada se perde
    });
  }

  // ---------- início ----------
  A.pedirPersistencia().then((p) => { persistente = p; renderInfo(); });
  renderMetas();
  renderAgendaCel();
  carregarMetas();
  carregar().then(sincronizarAgora);
})();
