import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { User, Shield, Bell, Database, LogOut, ChevronRight, Mail, Calendar, MessageSquare, Save, ExternalLink, Settings2, Users, Plus, Trash2, Send, Download, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { collection, getDocs, doc, getDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { BACKUP_VERSION, BACKUP_SUBCOLLECTIONS, encodeTimestamps, decodeTimestamps, validateBackup, countBackupItems, backupFilename, type Backup } from '../lib/backup';

export const Settings: React.FC = () => {
  const { user, logout } = useAuth();
  const { entities, selectedEntity, updateEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'data' | 'whatsapp' | 'telegram'>('profile');

  const [isSaving, setIsSaving] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'viewer'>('viewer');

  // WhatsApp State
  const [waApiUrl, setWaApiUrl] = useState(selectedEntity?.whatsappConfig?.apiUrl || '');
  const [waApiKey, setWaApiKey] = useState(selectedEntity?.whatsappConfig?.apiKey || '');
  const [waInstance, setWaInstance] = useState(selectedEntity?.whatsappConfig?.instanceName || '');
  const [waPhone, setWaPhone] = useState(selectedEntity?.whatsappConfig?.phoneNumber || '');
  const [waEnabled, setWaEnabled] = useState(selectedEntity?.whatsappConfig?.enabled || false);
  const [waStatus, setWaStatus] = useState<'connected' | 'disconnected' | 'loading' | 'disabled'>('loading');

  // Re-sincroniza os campos do WhatsApp ao trocar de entidade — os states acima
  // só rodam no mount, então sem isto os campos ficam presos na 1ª entidade.
  useEffect(() => {
    setWaApiUrl(selectedEntity?.whatsappConfig?.apiUrl || '');
    setWaApiKey(selectedEntity?.whatsappConfig?.apiKey || '');
    setWaInstance(selectedEntity?.whatsappConfig?.instanceName || '');
    setWaPhone(selectedEntity?.whatsappConfig?.phoneNumber || '');
    setWaEnabled(selectedEntity?.whatsappConfig?.enabled || false);
  }, [selectedEntity]);

  useEffect(() => {
    const checkStatus = async () => {
      if (!selectedEntity?.id || !waEnabled) {
        setWaStatus('disabled');
        return;
      }
      try {
        const response = await fetch(`/api/whatsapp/status/${selectedEntity.id}`);
        const data = await response.json();
        setWaStatus(data.instance?.state === 'open' ? 'connected' : 'disconnected');
      } catch (error) {
        setWaStatus('disconnected');
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [selectedEntity?.id, waEnabled]);

  const menuItems = [
    { id: 'profile', label: 'Meu Perfil', icon: User },
    { id: 'notifications', label: 'Notificações', icon: Bell },
    { id: 'whatsapp', label: 'WhatsApp Bot', icon: MessageSquare },
    { id: 'telegram', label: 'Telegram Bot', icon: Send },
    { id: 'data', label: 'Dados e Privacidade', icon: Database },
  ];

  const handleSaveWhatsApp = async () => {
    if (!selectedEntity) return;
    setIsSaving(true);
    try {
      await updateEntity(selectedEntity.id, {
        whatsappConfig: {
          apiUrl: waApiUrl,
          apiKey: waApiKey,
          instanceName: waInstance,
          phoneNumber: waPhone,
          enabled: waEnabled
        }
      });
      showToast('Configurações de WhatsApp salvas com sucesso!', 'success');
    } catch (error) {
      console.error('Error saving WhatsApp config:', error);
      showToast('Erro ao salvar configurações.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestWhatsApp = async () => {
    if (!selectedEntity?.whatsappConfig) return;
    setIsSaving(true);
    try {
      const { WhatsAppService } = await import('../services/WhatsAppService');
      const wa = new WhatsAppService(selectedEntity.whatsappConfig);
      await wa.sendText('🚀 *Teste de Conexão*\nSeu bot do Financeiro está configurado corretamente!');
      showToast('Mensagem de teste enviada com sucesso!', 'success');
    } catch (error) {
      console.error('Error testing WhatsApp:', error);
      showToast('Erro ao enviar mensagem de teste. Verifique as configurações.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: 'Sair da Conta',
      message: 'Tem certeza que deseja sair?',
      variant: 'default'
    });
    if (confirmed) {
      logout();
    }
  };

  // Preferências de notificação (persistidas). Vão alimentar os alertas de
  // Telegram/e-mail. Antes os toggles eram decorativos (não guardavam nada).
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('finanflow:notif-prefs') || '{}'); } catch { return {}; }
  });
  const toggleNotif = (key: string) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('finanflow:notif-prefs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Vínculo do Telegram: pede um código/deep link ao servidor (autenticado).
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgCode, setTgCode] = useState<string | null>(null);
  const [tgLoading, setTgLoading] = useState(false);
  const connectTelegram = async () => {
    if (!user) return;
    setTgLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/telegram/link-code', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Não foi possível gerar o link.', 'error'); return; }
      setTgCode(data.code || null);
      setTgLink(data.deepLink || null);
      if (!data.deepLink) showToast(`Abra o seu bot no Telegram e envie: /start ${data.code}`, 'info');
    } catch {
      showToast('Não consegui falar com o servidor. O Telegram só funciona com o app publicado (deploy) e o TELEGRAM_BOT_TOKEN configurado.', 'error');
    } finally {
      setTgLoading(false);
    }
  };

  // ---- Backup & Restauração (JSON) ----
  const [backupBusy, setBackupBusy] = useState(false);
  const isTs = (v: any) => v instanceof Timestamp;
  const tsToMs = (v: Timestamp) => v.toMillis();
  const msToTs = (ms: number) => Timestamp.fromMillis(ms);

  const downloadBackup = async () => {
    if (!user) return;
    setBackupBusy(true);
    try {
      const owned = entities.filter(e => e.ownerUid === user.uid);
      if (owned.length === 0) { showToast('Nenhuma entidade sua para exportar.', 'error'); return; }
      const backupEntities = [];
      const puladas: string[] = [];
      for (const ent of owned) {
        const entSnap = await getDoc(doc(db, `entities/${ent.id}`));
        const collections: Record<string, { id: string; data: any }[]> = {};
        for (const col of BACKUP_SUBCOLLECTIONS) {
          try {
            const snap = await getDocs(collection(db, `entities/${ent.id}/${col}`));
            collections[col] = snap.docs.map(d => ({ id: d.id, data: encodeTimestamps(d.data(), isTs, tsToMs) }));
          } catch {
            // Coleção sem permissão de leitura (regra não publicada) — pula e segue.
            if (!puladas.includes(col)) puladas.push(col);
          }
        }
        backupEntities.push({ id: ent.id, data: encodeTimestamps(entSnap.data() || {}, isTs, tsToMs), collections });
      }
      const backup: Backup = { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), app: 'finanflow', entities: backupEntities };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = backupFilename(backup.exportedAt);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const c = countBackupItems(backup);
      showToast(
        `Backup gerado: ${c.entities} entidade(s), ${c.documents} registros.${puladas.length ? ` (Sem permissão para: ${puladas.join(', ')} — publique as regras do Firestore para incluí-las.)` : ''}`,
        'success'
      );
    } catch (e) {
      console.error('Erro no backup:', e);
      showToast('Erro ao gerar o backup.', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async (file: File) => {
    if (!user) return;
    let obj: any;
    try { obj = JSON.parse(await file.text()); }
    catch { showToast('Arquivo não é um JSON válido.', 'error'); return; }
    const check = validateBackup(obj);
    if (!check.ok) { showToast(check.reason || 'Backup inválido.', 'error'); return; }
    const c = countBackupItems(obj);
    const ok = await confirm({
      title: 'Restaurar backup',
      message: `Isto vai gravar ${c.documents} registro(s) de ${c.entities} entidade(s), sobrescrevendo dados com o mesmo identificador. Recomendo baixar um backup atual antes. Deseja continuar?`,
      confirmText: 'Restaurar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setBackupBusy(true);
    try {
      let restaurados = 0, ignoradas = 0;
      for (const ent of obj.entities as Backup['entities']) {
        // Só restaura entidades que VOCÊ possui (as regras exigem ser dono/escritor).
        const owned = entities.find(e => e.id === ent.id && e.ownerUid === user.uid);
        if (!owned) { ignoradas++; continue; }
        for (const col of BACKUP_SUBCOLLECTIONS) {
          const docs = ent.collections[col] || [];
          try {
            for (let i = 0; i < docs.length; i += 400) {
              const batch = writeBatch(db);
              for (const d of docs.slice(i, i + 400)) {
                batch.set(doc(db, `entities/${ent.id}/${col}/${d.id}`), decodeTimestamps(d.data, msToTs));
              }
              await batch.commit();
              restaurados += Math.min(400, docs.length - i);
            }
          } catch (err) {
            // Sem permissão de escrita nessa coleção — pula e segue com as demais.
            console.warn(`Restauração: pulando ${col} de ${ent.id}`, err);
          }
        }
      }
      showToast(`Restauração concluída: ${restaurados} registro(s).${ignoradas ? ` ${ignoradas} entidade(s) do arquivo não são suas e foram ignoradas.` : ''}`, 'success');
    } catch (e) {
      console.error('Erro na restauração:', e);
      showToast('Erro ao restaurar o backup.', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDeleteAllData = async () => {
    // Exclusão total é irreversível e destrutiva; não é disparada às cegas pelo
    // app. Fica honesta: avisa que ainda não está ativa em vez de mostrar um
    // diálogo de perigo que não apaga nada.
    showToast('Por segurança, a exclusão total de dados ainda não está ativa neste app.', 'info');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">Configurações</h1>
        <p className="text-content-subtle">Gerencie sua conta e preferências do sistema</p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Sidebar */}
        <div className="w-full lg:w-64 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                activeTab === item.id 
                  ? "bg-primary text-white shadow-lg shadow-primary/20" 
                  : "text-content-muted hover:bg-surface-muted"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          ))}
          <hr className="my-4 border-line" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut className="h-5 w-5" />
            Sair da Conta
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 rounded-2xl border border-line bg-surface p-8 shadow-sm">
          {activeTab === 'profile' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-8"
            >
              <div className="flex items-center gap-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="h-12 w-12" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-content">{user?.email?.split('@')[0]}</h3>
                  <p className="text-content-subtle">Membro desde Abril 2026</p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">E-mail</label>
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-content-muted">
                    <Mail className="h-4 w-4" />
                    <span className="text-sm">{user?.email}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">ID do Usuário</label>
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-content-muted">
                    <Shield className="h-4 w-4" />
                    <span className="text-sm truncate">{user?.uid}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-blue-50 p-6 border border-blue-100">
                <h4 className="mb-2 font-bold text-blue-900">Entidades Ativas</h4>
                <div className="space-y-2">
                  {entities.map(entity => (
                    <div key={entity.id} className="flex items-center justify-between rounded-lg bg-white/50 px-4 py-2 text-sm">
                      <span className="font-medium text-blue-800">{entity.name}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600 uppercase">
                        {entity.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'notifications' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold text-content">Preferências de Notificação</h3>
              <p className="text-xs text-content-subtle">Estas preferências serão usadas pelos alertas no Telegram/e-mail.</p>
              <div className="space-y-4">
                {[
                  { key: 'payment', title: 'Lembretes de Pagamento', desc: 'Receba avisos sobre contas a vencer.' },
                  { key: 'weekly', title: 'Resumo Semanal', desc: 'Um relatório com seus gastos da semana.' },
                  { key: 'goal', title: 'Alertas de Meta', desc: 'Avisar quando atingir 80% do orçamento de uma categoria.' }
                ].map((item) => {
                  const on = !!notifPrefs[item.key];
                  return (
                    <div key={item.key} className="flex items-center justify-between rounded-xl border border-line p-4">
                      <div>
                        <p className="font-bold text-content">{item.title}</p>
                        <p className="text-xs text-content-subtle">{item.desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleNotif(item.key)}
                        aria-pressed={on}
                        aria-label={`Alternar ${item.title}`}
                        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600')}
                      >
                        <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all', on ? 'left-6' : 'left-1')} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'whatsapp' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-content">Integração WhatsApp (Evolution API)</h3>
                  <p className="text-sm text-content-subtle">Conecte sua conta para interagir via comandos e receber alertas.</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "h-2 w-2 rounded-full animate-pulse",
                      waStatus === 'connected' ? "bg-emerald-500" : 
                      waStatus === 'loading' ? "bg-amber-500" : "bg-red-500"
                    )} />
                    <span className="text-xs font-bold text-content-subtle uppercase">
                      {waStatus === 'connected' ? 'Conectado' : 
                       waStatus === 'loading' ? 'Verificando...' : 
                       waStatus === 'disabled' ? 'Desativado' : 'Desconectado'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-content-subtle uppercase">Bot</span>
                    <button
                      onClick={() => setWaEnabled(!waEnabled)}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        waEnabled ? "bg-emerald-600" : "bg-gray-200"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-surface transition-transform",
                        waEnabled ? "translate-x-6" : "translate-x-1"
                      )} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">URL da API</label>
                  <input
                    type="text"
                    value={waApiUrl}
                    onChange={(e) => setWaApiUrl(e.target.value)}
                    placeholder="https://api.sua-instancia.com"
                    className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">API Key</label>
                  <input
                    type="password"
                    value={waApiKey}
                    onChange={(e) => setWaApiKey(e.target.value)}
                    placeholder="Sua chave de API"
                    className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">Nome da Instância</label>
                  <input
                    type="text"
                    value={waInstance}
                    onChange={(e) => setWaInstance(e.target.value)}
                    placeholder="Ex: Financeiro"
                    className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-content-subtle">Seu Número (WhatsApp)</label>
                  <input
                    type="text"
                    value={waPhone}
                    onChange={(e) => setWaPhone(e.target.value)}
                    placeholder="Ex: 5511999999999"
                    className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-primary transition-all"
                  />
                  <p className="text-[10px] text-content-subtle">Apenas este número poderá enviar comandos ao bot.</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl bg-indigo-50 p-6 border border-indigo-100">
                  <h4 className="mb-2 font-bold text-indigo-900 flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Configuração de Webhook
                  </h4>
                  <p className="text-sm text-indigo-700 mb-4">
                    Para que o bot responda aos seus comandos, configure este Webhook na Evolution API:
                  </p>
                  <div className="flex items-center gap-3 rounded-lg bg-surface p-3 border border-indigo-200">
                    <code className="text-xs font-mono text-indigo-600 flex-1 break-all">
                      {window.location.origin}/api/whatsapp/webhook
                    </code>
                    <button 
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/whatsapp/webhook`)}
                      className="text-indigo-400 hover:text-indigo-600"
                    >
                      <Save className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-bold text-indigo-800 uppercase">Eventos Necessários:</p>
                    <ul className="text-xs text-indigo-600 list-disc list-inside">
                      <li>MESSAGES_UPSERT</li>
                    </ul>
                  </div>
                </div>

                <div className="rounded-xl bg-emerald-50 p-6 border border-emerald-100">
                  <h4 className="mb-2 font-bold text-emerald-900 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Comandos Suportados
                  </h4>
                  <p className="text-sm text-emerald-700 mb-4">
                    Envie estes comandos para o número do bot:
                  </p>
                  <div className="space-y-3">
                    {[
                      { cmd: 'Saldo', desc: 'Ver saldo total consolidado' },
                      { cmd: 'Extrato', desc: 'Ver últimos 5 lançamentos' },
                      { cmd: 'Lançar [valor] [desc]', desc: 'Registrar gasto rápido' },
                      { cmd: 'Dívidas', desc: 'Resumo de pagamentos pendentes' },
                      { cmd: 'Ajuda', desc: 'Lista todos os comandos' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/50 px-3 py-2 text-xs">
                        <code className="font-bold text-emerald-800">*{item.cmd}*</code>
                        <span className="text-emerald-600">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={handleTestWhatsApp}
                  disabled={isSaving || !waEnabled}
                  className="flex items-center gap-2 rounded-xl border border-line px-6 py-3 text-sm font-bold text-content-muted hover:bg-canvas transition-all disabled:opacity-50"
                >
                  Testar Conexão
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  onClick={handleSaveWhatsApp}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Configurações'}
                  <Save className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}

          {activeTab === 'telegram' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-600 dark:bg-sky-950/40">
                  <Send className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-content">Telegram Bot</h3>
                  <p className="text-sm text-content-subtle">Receba alertas no celular e lance por mensagem/foto.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-canvas p-5 text-sm text-content-muted">
                <p className="font-bold text-content mb-2">O que o bot faz</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Avisa <b>contas a vencer</b>, <b>saldo no vermelho</b> e <b>orçamento estourado</b>.</li>
                  <li>Manda um <b>resumo semanal</b> (segunda de manhã).</li>
                  <li>Aceita comandos: <i>“saldo”, “quanto tenho a pagar”, “gastei 50 no posto”</i> e foto de nota.</li>
                  <li>Tudo num chat só, marcado <b>[PF]</b> / <b>[PJ]</b>. Ajuste as preferências na aba <b>Notificações</b>.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-4">
                <p className="font-bold text-content">Conectar seu chat</p>
                <p className="text-sm text-content-subtle">
                  Toque em conectar, abra o bot no Telegram e confirme com <code>/start</code>. É preciso fazer isso uma vez.
                </p>
                <button
                  onClick={connectTelegram}
                  disabled={tgLoading}
                  className="flex items-center gap-2 rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-600/20 hover:bg-sky-700 transition-all disabled:opacity-50"
                >
                  {tgLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send className="h-4 w-4" />}
                  Conectar Telegram
                </button>

                {(tgLink || tgCode) && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-950/30 p-4 text-sm">
                    {tgLink ? (
                      <a href={tgLink} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-2 font-bold text-sky-700 dark:text-sky-300 hover:underline">
                        <ExternalLink className="h-4 w-4" /> Abrir o bot e confirmar
                      </a>
                    ) : (
                      <p className="text-content-muted">Abra o seu bot no Telegram e envie:</p>
                    )}
                    {tgCode && (
                      <p className="mt-2 font-mono text-content">/start {tgCode}</p>
                    )}
                    <p className="mt-2 text-xs text-content-subtle">O código expira em pouco tempo — se falhar, gere outro.</p>
                  </div>
                )}
              </div>

              <p className="text-xs text-content-subtle">
                Requer o <code>TELEGRAM_BOT_TOKEN</code> configurado no servidor (feito no deploy).
              </p>
            </motion.div>
          )}

          {activeTab === 'data' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold text-content">Gerenciamento de Dados</h3>

              {/* Backup & Restauração */}
              <div className="rounded-2xl border border-line bg-canvas p-6">
                <div className="mb-1 flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-content">Backup & Restauração</h4>
                </div>
                <p className="mb-4 text-sm text-content-subtle">
                  Baixe um arquivo com <strong>todos os seus dados</strong> (lançamentos, contas, cartões, dívidas, clientes, fornecedores, serviços, orçamentos, metas e configurações). Guarde em local seguro. Para voltar os dados, use “Restaurar”.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={downloadBackup}
                    disabled={backupBusy}
                    className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    <Download className="h-4 w-4" />
                    {backupBusy ? 'Processando...' : 'Baixar backup (.json)'}
                  </button>
                  <label className={cn(
                    'flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-bold text-content hover:bg-surface-muted',
                    backupBusy && 'pointer-events-none opacity-60'
                  )}>
                    <Upload className="h-4 w-4" />
                    Restaurar de arquivo
                    <input
                      type="file" accept="application/json,.json" className="hidden"
                      disabled={backupBusy}
                      onChange={e => { const f = e.target.files?.[0]; if (f) restoreBackup(f); e.target.value = ''; }}
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs text-content-subtle">
                  A restauração grava por cima de registros com o mesmo identificador e só afeta entidades das quais você é o dono. Backup automático agendado poderá ser ativado no servidor após o deploy na VPS.
                </p>
              </div>

              <div className="rounded-xl border border-red-100 bg-red-50 p-6">
                <h4 className="mb-2 font-bold text-red-900">Zona de Perigo</h4>
                <p className="mb-4 text-sm text-red-700">
                  Ao excluir seus dados, todas as transações, contas e cartões serão removidos permanentemente. Esta ação não pode ser desfeita.
                </p>
                <button 
                  onClick={handleDeleteAllData}
                  className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-all"
                >
                  Excluir Todos os Meus Dados
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
