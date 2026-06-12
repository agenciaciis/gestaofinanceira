import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../firebase';
import { CreditCard } from '../types';
import { 
  Bell, 
  CreditCard as CardIcon, 
  Calendar, 
  AlertCircle, 
  Clock, 
  CheckCircle2,
  X,
  Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  createdAt: any;
  read: boolean;
}

export const Notifications: React.FC = () => {
  const { entities } = useEntity();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (entities.length === 0) return;

    const unsubscribes: (() => void)[] = [];
    let allCards: CreditCard[] = [];

    entities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/credit_cards`));
      const unsub = onSnapshot(q, (snapshot) => {
        const entityCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CreditCard[];
        allCards = [...allCards.filter(c => c.entityId !== entity.id), ...entityCards];
        setCards([...allCards]);
      });
      unsubscribes.push(unsub);
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities]);

  const generateCardAlerts = () => {
    const alerts: Notification[] = [];
    const today = new Date().getDate();
    const now = new Date();

    cards.forEach(card => {
      // Closing Alert (3 days before)
      if (card.closingDay - today <= 3 && card.closingDay - today > 0) {
        alerts.push({
          id: `closing-${card.id}`,
          title: 'Fatura Próxima ao Fechamento',
          message: `A fatura do cartão ${card.name} fecha em ${card.closingDay - today} dias.`,
          type: 'warning',
          createdAt: now,
          read: false
        });
      }

      // Due Date Alert (5 days before)
      if (card.dueDay - today <= 5 && card.dueDay - today > 0) {
        alerts.push({
          id: `due-${card.id}`,
          title: 'Vencimento de Fatura',
          message: `O vencimento do cartão ${card.name} é em ${card.dueDay - today} dias (Dia ${card.dueDay}).`,
          type: 'error',
          createdAt: now,
          read: false
        });
      }
    });

    return alerts;
  };

  const allNotifications = [...generateCardAlerts()];
  const unreadCount = allNotifications.length;

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-gray-100 bg-white p-4 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between border-b pb-2">
                <h3 className="text-sm font-bold text-gray-900">Notificações</h3>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{unreadCount} Pendentes</span>
              </div>

              <div className="max-h-[400px] overflow-y-auto space-y-3">
                {allNotifications.length === 0 ? (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-gray-100" />
                    <p className="mt-2 text-xs text-gray-400">Tudo em dia por aqui!</p>
                  </div>
                ) : (
                  allNotifications.map((n) => (
                    <div 
                      key={n.id} 
                      className={cn(
                        "flex gap-3 rounded-xl p-3 transition-all border",
                        n.type === 'warning' ? "bg-orange-50 border-orange-100" : 
                        n.type === 'error' ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        n.type === 'warning' ? "bg-orange-100 text-orange-600" : 
                        n.type === 'error' ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                      )}>
                        {n.type === 'warning' ? <Clock className="h-4 w-4" /> : 
                         n.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-gray-900">{n.title}</p>
                        <p className="mt-0.5 text-[10px] text-gray-600 leading-relaxed">{n.message}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                            <Mail className="h-3 w-3" /> Enviar E-mail
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 border-t pt-2">
                <button className="w-full text-center text-[10px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">
                  Ver todas as notificações
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
