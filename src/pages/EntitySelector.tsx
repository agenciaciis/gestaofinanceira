import React, { useState } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useAuth } from '../contexts/AuthContext';
import { Plus, User, Briefcase, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

export const EntitySelector: React.FC = () => {
  const { entities, createEntity, setSelectedEntity, selectedEntity } = useEntity();
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'PF' | 'PJ'>('PF');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    await createEntity(newName, newType);
    setIsCreating(false);
    setNewName('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-content">Bem-vindo, {user?.displayName}</h2>
          <p className="mt-2 text-content-muted">Selecione ou crie uma entidade para gerenciar</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {entities.map((entity) => (
            <motion.button
              key={entity.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedEntity(entity)}
              className={cn(
                "relative flex items-center gap-4 rounded-xl border-2 p-6 text-left transition-all",
                selectedEntity?.id === entity.id 
                  ? "border-primary bg-primary/5 ring-1 ring-primary" 
                  : "border-white bg-surface hover:border-line shadow-sm"
              )}
            >
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full",
                entity.type === 'PF' ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
              )}>
                {entity.type === 'PF' ? <User className="h-6 w-6" /> : <Briefcase className="h-6 w-6" />}
              </div>
              <div>
                <h3 className="font-bold text-content">{entity.name}</h3>
                <p className="text-sm text-content-subtle">{entity.type === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}</p>
              </div>
              {selectedEntity?.id === entity.id && (
                <div className="absolute right-4 top-4 text-primary">
                  <Check className="h-5 w-5" />
                </div>
              )}
            </motion.button>
          ))}

          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line p-6 text-content-subtle hover:border-primary hover:text-primary transition-all"
          >
            <Plus className="h-6 w-6" />
            <span className="font-semibold">Nova Entidade</span>
          </button>
        </div>

        {isCreating && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <div className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-2xl">
              <h3 className="text-xl font-bold text-content">Criar Nova Entidade</h3>
              <form onSubmit={handleCreate} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Nome</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Minhas Finanças ou Empresa X"
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Tipo</label>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewType('PF')}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-all",
                        newType === 'PF' ? "border-primary bg-primary/5 text-primary" : "border-line text-content-muted hover:bg-canvas"
                      )}
                    >
                      <User className="h-4 w-4" /> Pessoa Física
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewType('PJ')}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-all",
                        newType === 'PJ' ? "border-primary bg-primary/5 text-primary" : "border-line text-content-muted hover:bg-canvas"
                      )}
                    >
                      <Briefcase className="h-4 w-4" /> Pessoa Jurídica
                    </button>
                  </div>
                </div>
                <div className="mt-8 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-content-muted hover:bg-canvas"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-primary/90"
                  >
                    Criar
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
