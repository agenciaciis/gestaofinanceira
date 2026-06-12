/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EntityProvider, useEntity } from './contexts/EntityContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { BankAccounts } from './pages/BankAccounts';
import { CreditCards } from './pages/CreditCards';
import { Transactions } from './pages/Transactions';
import { Reports } from './pages/Reports';
import { Budgets } from './pages/Budgets';
import { Clients } from './pages/Clients';
import { Suppliers } from './pages/Suppliers';
import { FinancialHealth } from './pages/FinancialHealth';
import { Services } from './pages/Services';
import { Quotes } from './pages/Quotes';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { Login } from './pages/Login';
import { EntitySelector } from './pages/EntitySelector';

import { ThemeProvider } from './contexts/ThemeContext';
import { UIProvider } from './contexts/UIContext';

console.log('App component rendering');

const AppContent: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const { selectedEntity, entities, loading: entityLoading } = useEntity();
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'accounts' | 'cards' | 'transactions' | 'reports' | 'budgets' | 'clients' | 'suppliers' | 'health' | 'settings' | 'entities' | 'services' | 'quotes' | 'team'>('dashboard');
  const [showTimeout, setShowTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (authLoading || entityLoading) {
        setShowTimeout(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [authLoading, entityLoading]);

  if (authLoading || entityLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        {showTimeout && (
          <div className="text-center">
            <p className="text-sm text-gray-500">O carregamento está demorando mais que o esperado...</p>
            <p className="text-xs text-gray-400 mt-1">Verifique sua conexão ou as configurações do Firebase.</p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 text-xs font-bold text-primary underline"
            >
              Tentar recarregar
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (entities.length === 0) {
    return <EntitySelector />;
  }

  return (
    <Layout onNavigate={setCurrentPage} currentPage={currentPage}>
      {currentPage === 'dashboard' ? <Dashboard /> : 
       currentPage === 'accounts' ? <BankAccounts /> : 
       currentPage === 'cards' ? <CreditCards /> :
       currentPage === 'transactions' ? <Transactions /> :
       currentPage === 'reports' ? <Reports /> :
       currentPage === 'budgets' ? <Budgets /> :
       currentPage === 'clients' ? <Clients /> :
       currentPage === 'suppliers' ? <Suppliers /> :
       currentPage === 'health' ? <FinancialHealth /> :
       currentPage === 'services' ? <Services /> :
       currentPage === 'quotes' ? <Quotes /> :
       currentPage === 'team' ? <Team /> :
       currentPage === 'settings' ? <Settings /> :
       <EntitySelector />}
    </Layout>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <UIProvider>
        <AuthProvider>
          <EntityProvider>
            <AppContent />
          </EntityProvider>
        </AuthProvider>
      </UIProvider>
    </ThemeProvider>
  );
}
