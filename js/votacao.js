/* ══════════════════════════════════════════════════════════════
   votacao.js — SDP-OAB/GO
   Funções da aba "Votação Individual"
══════════════════════════════════════════════════════════════ */

let _votacaoFichaId = null;

async function iniciarVotacao() {
  var estadoEl = document.getElementById('votacaoEstado');
  var mainEl   = document.getElementById('votacaoMain');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; }
  if (mainEl)   mainEl.style.display = 'none';

  try {
    var estado = await gasGet({ acao: 'estadoAtivo' });
    if (!estado.processoVotacao) {
      if (estadoEl) {
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">how_to_vote</i><p>Nenhum processo em votação no momento.</p>';
      }
      return;
    }

    _votacaoFichaId = estado.processoVotacao;

    var [dadosVotacao] = await Promise.all([
      gasGet({ acao: 'infoVotacao', fichaId: _votacaoFichaId }),
      carregarMembros()
    ]);

    if (!dadosVotacao.sucesso) throw new Error(dadosVotacao.erro || 'Erro ao carregar dados.');

    document.getElementById('votacaoTitulo').textContent = dadosVotacao.titulo || 'Votação';
    var dataHtml = '';
    if (dadosVotacao.dataSessao) dataHtml += '<i class="material-icons" style="font-size:16px">event</i> ' + dadosVotacao.dataSessao;
    if (dadosVotacao.orgao) dataHtml += (dataHtml ? ' · ' : '') + dadosVotacao.orgao;
    document.getElementById('votacaoData').innerHTML = dataHtml;

    var cabecalhoEl = document.getElementById('votacaoCabecalho');
    if (cabecalhoEl && dadosVotacao) {
      var html = '';
      if (dadosVotacao.requerente) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerente</span><span class="votacao-valor">' + dadosVotacao.requerente + '</span></div>';
      if (dadosVotacao.requerido) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerido</span><span class="votacao-valor">' + dadosVotacao.requerido + '</span></div>';
      if (dadosVotacao.ementa) html += '<div class="votacao-info-linha votacao-ementa"><span class="votacao-rotulo">Ementa</span><span class="votacao-valor">' + dadosVotacao.ementa + '</span></div>';
      cabecalhoEl.innerHTML = html;
    }

    renderExposicaoVotos(dadosVotacao.votos || []);
    renderFormularioVotacao(dadosVotacao.opcoesVoto || []);

    if (estadoEl) estadoEl.style.display = 'none';
    if (mainEl)   mainEl.style.display = 'block';

  } catch (err) {
    console.error('[votacao] erro:', err);
    if (estadoEl) {
      estadoEl.className = 'estado erro';
      estadoEl.innerHTML = '<i class="material-icons">error_outline</i><p>Não foi possível carregar os dados.<br>' + err.message + '</p>';
    }
  }
}

function renderExposicaoVotos(votos) {
  var container = document.getElementById('votacaoVotos');
  if (!container) return;

  if (!votos.length) {
    container.innerHTML = '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
    return;
  }

  var html = '';
  votos.forEach(function(v) {
    var textoLimpo = (v.texto || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    html +=
      '<div class="voto-exposicao-card">' +
        '<div class="voto-exposicao-header">' +
          '<span class="voto-exposicao-tipo">' + (v.tipo || 'Voto').toUpperCase() + '</span>' +
          '<span class="voto-exposicao-relator">' + (v.relator || '—') + '</span>' +
        '</div>' +
        '<div class="voto-exposicao-body">' +
          '<p class="voto-exposicao-texto">' + textoLimpo + '</p>' +
        '</div>' +
      '</div>';
  });
  container.innerHTML = html;
}

function renderFormularioVotacao(opcoes) {
  var container = document.getElementById('votacaoOpcoes');
  if (!container) return;

  var html = '';
  opcoes.forEach(function(opcao) {
    html +=
      '<label class="opcao-voto-label" onclick="selecionarVoto(this)">' +
        '<input type="radio" name="votacaoOpcao" value="' + opcao + '">' +
        opcao +
      '</label>';
  });
  container.innerHTML = html;

  var select = document.getElementById('votacaoSelectNome');
  if (select && select.options.length <= 1) {
    select.innerHTML = '<option value="" disabled selected>Escolha seu nome</option>';
    Object.keys(_membrosCache).sort(function(a,b){ return a.localeCompare(b,'pt-BR'); }).forEach(function(nome) {
      var opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      select.appendChild(opt);
    });
    M.FormSelect.init(select, {});
  }

  document.getElementById('btnConfirmarVotacao').onclick = confirmarVotoIndividual;
}

async function confirmarVotoIndividual() {
  var select = document.getElementById('votacaoSelectNome');
  var nome   = select ? select.value.trim() : '';
  var radioSel = document.querySelector('input[name="votacaoOpcao"]:checked');

  if (!nome) { toast('Selecione seu nome na lista.', 'erro'); return; }
  if (!radioSel) { toast('Selecione uma opção de voto.', 'erro'); return; }

  var btn = document.getElementById('btnConfirmarVotacao');
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:15px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'votar', nome: nome, voto: radioSel.value, idFicha: _votacaoFichaId });
    toast('Voto registrado com sucesso!');

    select.value = '';
    var inst = M.FormSelect.getInstance(select);
    if (inst) inst.destroy();
    M.FormSelect.init(select, {});
    document.querySelectorAll('input[name="votacaoOpcao"]').forEach(function(r) {
      r.checked = false;
      var p = r.closest('.opcao-voto-label');
      if (p) p.classList.remove('selecionada');
    });

  } catch (err) {
    toast('Erro ao registrar voto.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons" style="font-size:15px">check</i> Confirmar voto';
  }
}