import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { User, Shield, Bell, Database, LogOut, ChevronRight, Mail, Calendar, MessageSquare, Save, ExternalLink, Settings2, Users, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

export const Settings: React.FC = () => {
  const { user, logout } = useAuth();
  const { entities, selectedEntity, updateEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'data' | 'whatsapp'>('profile');

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

  const handleDeleteAllData = async () => {
    const confirmed = await confirm({
      title: 'EXCLUIR TODOS OS DADOS',
      message: 'ESTA AÇÃO É IRREVERSÍVEL. Todos os seus dados serão apagados permanentemente. Deseja continuar?',
      variant: 'danger'
    });
    if (confirmed) {
      showToast('Funcionalidade de exclusão total em desenvolvimento.', 'info');
    }
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
              <div className="space-y-4">
                {[
                  { title: 'Lembretes de Pagamento', desc: 'Receba avisos sobre contas a vencer.' },
                  { title: 'Resumo Semanal', desc: 'Um relatório por e-mail com seus gastos da semana.' },
                  { title: 'Alertas de Meta', desc: 'Avisar quando atingir 80% do orçamento de uma categoria.' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-gray-50 p-4">
                    <div>
                      <p className="font-bold text-content">{item.title}</p>
                      <p className="text-xs text-content-subtle">{item.desc}</p>
                    </div>
                    <div className="h-6 w-11 rounded-full bg-gray-200 p-1 cursor-not-allowed">
                      <div className="h-4 w-4 rounded-full bg-surface shadow-sm"></div>
                    </div>
                  </div>
                ))}
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

          {activeTab === 'data' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold text-content">Gerenciamento de Dados</h3>
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
