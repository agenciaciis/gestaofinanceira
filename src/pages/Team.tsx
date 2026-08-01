import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { 
  Users, 
  UserPlus, 
  Mail, 
  Shield, 
  Trash2, 
  Search,
  User,
  ShieldCheck,
  ShieldAlert,
  Clock,
  MoreVertical,
  X,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export const Team: React.FC = () => {
  const { user } = useAuth();
  const { entities, selectedEntity, addCollaborator, removeCollaborator } = useEntity();
  const { showToast, confirm } = useUI();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form state
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'viewer'>('viewer');
  const [targetEntityId, setTargetEntityId] = useState(selectedEntity?.id || '');

  const isOwner = selectedEntity?.ownerUid === user?.uid;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail || !targetEntityId) return;

    setIsSaving(true);
    try {
      await addCollaborator(targetEntityId, newMemberEmail, newMemberRole);
      setNewMemberEmail('');
      setIsModalOpen(false);
      showToast('Convite enviado com sucesso!', 'success');
    } catch (error) {
      console.error('Error inviting member:', error);
      showToast('Erro ao convidar membro. Verifique se o e-mail é válido.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (entityId: string, email: string) => {
    const confirmed = await confirm({
      title: 'Remover Membro',
      message: `Tem certeza que deseja remover ${email} da equipe?`,
      variant: 'danger'
    });
    
    if (!confirmed) return;
    
    setIsSaving(true);
    try {
      await removeCollaborator(entityId, email);
      showToast('Membro removido com sucesso.', 'success');
    } catch (error) {
      console.error('Error removing member:', error);
      showToast('Erro ao remover membro.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const allCollaborators = entities.flatMap(entity => 
    (entity.collaborators || []).map(c => ({ ...c, entityName: entity.name, entityId: entity.id, entityOwnerUid: entity.ownerUid }))
  );

  const filteredCollaborators = allCollaborators.filter(c => 
    c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.entityName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-black text-content tracking-tight">Equipe & Acessos</h2>
          <p className="text-sm font-medium text-content-subtle">Gerencie quem pode visualizar ou editar suas entidades financeiras.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
        >
          <UserPlus className="h-4 w-4" />
          Convidar Membro
        </button>
      </div>

      {/* Search and Filters */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
        <input
          type="text"
          placeholder="Buscar por e-mail ou entidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-2xl border border-line bg-surface py-3 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
        />
      </div>

      {/* Collaborators List */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Current User (Owner) Card */}
        <div className="rounded-3xl bg-surface p-6 shadow-sm border border-line relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <User className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary uppercase tracking-wider">
              Proprietário
            </span>
          </div>
          <div className="mt-6">
            <h3 className="text-lg font-black text-content truncate">{user?.email}</h3>
            <p className="text-xs font-medium text-content-subtle mt-1">Você é o dono de {entities.filter(e => e.ownerUid === user?.uid).length} entidades.</p>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-bold text-content-muted">Acesso Total</span>
          </div>
          <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-primary/5" />
        </div>

        {/* Collaborators Cards */}
        <AnimatePresence mode="popLayout">
          {filteredCollaborators.map((member, idx) => (
            <motion.div
              key={`${member.entityId}-${member.email}`}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="group rounded-3xl bg-surface p-6 shadow-sm border border-line hover:shadow-xl hover:border-primary/20 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-content-subtle group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  <User className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider",
                    member.role === 'admin' ? "bg-purple-100 text-purple-600" : "bg-surface-muted text-content-muted"
                  )}>
                    {member.role === 'admin' ? 'Admin' : 'Viewer'}
                  </span>
                  {member.entityOwnerUid === user?.uid && (
                    <button 
                      onClick={() => handleRemove(member.entityId, member.email)}
                      className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-all"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-6">
                <h3 className="text-lg font-black text-content truncate">{member.email}</h3>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <p className="text-xs font-bold text-content-subtle">Acesso à: <span className="text-content">{member.entityName}</span></p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 text-content-subtle">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    {(() => {
                      const raw: any = member.addedAt;
                      const d = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
                      return d && !Number.isNaN(d.getTime()) ? `Desde ${d.toLocaleDateString('pt-BR')}` : 'Colaborador';
                    })()}
                  </span>
                </div>
                {member.entityOwnerUid !== user?.uid && (
                  <div className="flex items-center gap-1 text-amber-500" title="Você não é o dono desta entidade">
                    <ShieldAlert className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredCollaborators.length === 0 && searchTerm && (
          <div className="col-span-full py-12 text-center">
            <Users className="h-12 w-12 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-content">Nenhum membro encontrado</h3>
            <p className="text-content-subtle">Tente buscar por outro termo ou e-mail.</p>
          </div>
        )}

        {allCollaborators.length === 0 && !searchTerm && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-line p-12 text-center bg-slate-50/50">
            <div className="mb-4 rounded-full bg-surface p-4 shadow-sm">
              <Users className="h-8 w-8 text-content-subtle" />
            </div>
            <h3 className="text-xl font-black text-content">Sua equipe está vazia</h3>
            <p className="mt-2 max-w-xs text-content-subtle font-medium">Convide colaboradores para ajudar a gerenciar suas finanças.</p>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="mt-8 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
            >
              Convidar Primeiro Membro
            </button>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-2xl border border-line dark:border-gray-800"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserPlus className="h-6 w-6" />
              </div>
              <button onClick={() => setIsModalOpen(false)} className="rounded-xl p-2 text-content-subtle hover:bg-surface-muted transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            <h3 className="text-2xl font-black text-content tracking-tight">Convidar para Equipe</h3>
            <p className="text-content-subtle font-medium mt-1">O convidado terá acesso aos dados da entidade selecionada.</p>

            <form onSubmit={handleInvite} className="mt-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-content-subtle px-1">E-mail do Convidado</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-content-subtle" />
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="exemplo@email.com"
                    className="w-full rounded-2xl border border-line bg-slate-50/50 py-3 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface transition-all"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-content-subtle px-1">Entidade</label>
                  <select 
                    value={targetEntityId}
                    onChange={(e) => setTargetEntityId(e.target.value)}
                    className="w-full rounded-2xl border border-line bg-slate-50/50 py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface transition-all"
                    required
                  >
                    <option value="">Selecione...</option>
                    {entities.filter(e => e.ownerUid === user?.uid).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-content-subtle px-1">Nível de Acesso</label>
                  <select 
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as any)}
                    className="w-full rounded-2xl border border-line bg-slate-50/50 py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface transition-all"
                  >
                    <option value="viewer">Visualizador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl bg-amber-50 p-4 border border-amber-100">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <span className="font-bold">Atenção:</span> O convidado deve possuir uma conta no sistema com este e-mail para acessar os dados.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-2xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !newMemberEmail || !targetEntityId}
                  className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50"
                >
                  {isSaving ? 'Enviando...' : 'Enviar Convite'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
