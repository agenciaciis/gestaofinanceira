/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EntityProvider, useEntity } from './contexts/EntityContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { EntitySelector } from './pages/EntitySelector';

import { ThemeProvider } from './contexts/ThemeContext';
import { UIProvider } from './contexts/UIContext';

// Páginas carregadas sob demanda (code-splitting) para acelerar o carregamento inicial.
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const BankAccounts = lazy(() => import('./pages/BankAccounts').then(m => ({ default: m.BankAccounts })));
const CreditCards = lazy(() => import('./pages/CreditCards').then(m => ({ default: m.CreditCards })));
const Transactions = lazy(() => import('./pages/Transactions').then(m => ({ default: m.Transactions })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Budgets = lazy(() => import('./pages/Budgets').then(m => ({ default: m.Budgets })));
const Clients = lazy(() => import('./pages/Clients').then(m => ({ default: m.Clients })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const FinancialHealth = lazy(() => import('./pages/FinancialHealth').then(m => ({ default: m.FinancialHealth })));
const Services = lazy(() => import('./pages/Services').then(m => ({ default: m.Services })));
const Quotes = lazy(() => import('./pages/Quotes').then(m => ({ default: m.Quotes })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Team = lazy(() => import('./pages/Team').then(m => ({ default: m.Team })));

const PageLoader: React.FC = () => (
  <div className="flex h-[60vh] items-center justify-center">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

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
            <p className="text-sm text-content-subtle">O carregamento está demorando mais que o esperado...</p>
            <p className="text-xs text-content-subtle mt-1">Verifique sua conexão ou as configurações do Firebase.</p>
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
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
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
