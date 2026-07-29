import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEntity, FilterType } from '../contexts/EntityContext';
import { 
  LayoutDashboard, 
  CreditCard, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  PieChart, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  ChevronDown,
  User,
  Briefcase,
  Wallet,
  Landmark,
  Layers,
  Target,
  Users,
  Bell,
  Truck,
  Heart,
  Sun,
  Moon,
  Package,
  FileText
} from 'lucide-react';
import { Notifications } from './Notifications';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all",
      active 
        ? "bg-primary text-white shadow-md" 
        : "text-content-muted dark:text-gray-400 hover:bg-surface-muted dark:hover:bg-gray-800 hover:text-content dark:hover:text-gray-100"
    )}
  >
    <Icon className="h-5 w-5" />
    {label}
  </button>
);

export const Layout: React.FC<{ 
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: any) => void;
}> = ({ children, currentPage, onNavigate }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { entities, filterType, setFilterType, selectedEntity } = useEntity();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

  const getFilterLabel = (type: FilterType) => {
    switch(type) {
      case 'PF': return 'Pessoa Física';
      case 'PJ': return 'Pessoa Jurídica';
      case 'ALL': return 'Visão Consolidada';
    }
  };

  const getFilterIcon = (type: FilterType) => {
    switch(type) {
      case 'PF': return <User className="h-4 w-4" />;
      case 'PJ': return <Briefcase className="h-4 w-4" />;
      case 'ALL': return <Layers className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex min-h-screen bg-canvas dark:bg-gray-950 transition-colors duration-300">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 transform bg-surface dark:bg-gray-900 border-r border-line dark:border-gray-800 shadow-xl transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col p-4">
          <div className="mb-8 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
                <Briefcase className="h-6 w-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-black text-content dark:text-gray-100 tracking-tighter">AGÊNCIA CIIS</span>
                <span className="text-[10px] font-bold text-primary uppercase tracking-widest">FinanFlow</span>
              </div>
            </div>
            <button className="lg:hidden text-content-subtle" onClick={() => setIsSidebarOpen(false)}>
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* View Filter Selector */}
          <div className="relative mb-8">
            <button 
              onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              className="flex w-full items-center justify-between rounded-xl border border-line dark:border-gray-800 bg-canvas dark:bg-gray-800/50 p-3 text-left transition-all hover:bg-surface-muted dark:hover:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  filterType === 'PF' ? "bg-blue-100 text-blue-600" : 
                  filterType === 'PJ' ? "bg-purple-100 text-purple-600" : "bg-orange-100 text-orange-600"
                )}>
                  {getFilterIcon(filterType)}
                </div>
                <div>
                  <p className="text-xs font-medium text-content-subtle">Visualização</p>
                  <p className="text-sm font-bold text-content truncate max-w-[120px]">{getFilterLabel(filterType)}</p>
                </div>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-content-subtle transition-transform", isFilterMenuOpen && "rotate-180")} />
            </button>

            {isFilterMenuOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-line dark:border-gray-800 bg-surface dark:bg-gray-900 p-2 shadow-2xl">
                {(['ALL', 'PF', 'PJ'] as FilterType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setFilterType(type);
                      setIsFilterMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                      filterType === type ? "bg-primary/5 text-primary" : "text-content-muted hover:bg-canvas"
                    )}
                  >
                    {getFilterIcon(type)}
                    <span className="font-medium">{getFilterLabel(type)}</span>
                  </button>
                ))}
                <div className="my-1 border-t" />
                <button 
                  onClick={() => onNavigate('entities')}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-content-muted hover:bg-canvas"
                >
                  <Settings className="h-4 w-4" />
                  Gerenciar Entidades
                </button>
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-1">
            <NavItem 
              icon={LayoutDashboard} 
              label="Dashboard" 
              active={currentPage === 'dashboard'} 
              onClick={() => onNavigate('dashboard')}
            />
            <NavItem 
              icon={ArrowUpCircle} 
              label="Lançamentos" 
              active={currentPage === 'transactions'}
              onClick={() => onNavigate('transactions')}
            />
            <NavItem 
              icon={Landmark} 
              label="Contas" 
              active={currentPage === 'accounts'} 
              onClick={() => onNavigate('accounts')}
            />
            <NavItem 
              icon={CreditCard} 
              label="Cartões" 
              active={currentPage === 'cards'}
              onClick={() => onNavigate('cards')}
            />
            <NavItem 
              icon={PieChart} 
              label="Relatórios" 
              active={currentPage === 'reports'}
              onClick={() => onNavigate('reports')}
            />
            <NavItem 
              icon={Target} 
              label="Metas" 
              active={currentPage === 'budgets'}
              onClick={() => onNavigate('budgets')}
            />
            <NavItem 
              icon={Users} 
              label="Clientes" 
              active={currentPage === 'clients'}
              onClick={() => onNavigate('clients')}
            />
            <NavItem 
              icon={Package} 
              label="Serviços" 
              active={currentPage === 'services'}
              onClick={() => onNavigate('services')}
            />
            <NavItem 
              icon={FileText} 
              label="Orçamentos" 
              active={currentPage === 'quotes'}
              onClick={() => onNavigate('quotes')}
            />
            <NavItem 
              icon={Truck} 
              label="Fornecedores" 
              active={currentPage === 'suppliers'}
              onClick={() => onNavigate('suppliers')}
            />
            <NavItem 
              icon={Heart} 
              label="Saúde Financeira" 
              active={currentPage === 'health'} 
              onClick={() => onNavigate('health')}
            />
            <NavItem 
              icon={Users} 
              label="Equipe" 
              active={currentPage === 'team'}
              onClick={() => onNavigate('team')}
            />
            <NavItem 
              icon={Settings} 
              label="Ajustes" 
              active={currentPage === 'settings'}
              onClick={() => onNavigate('settings')}
            />
          </nav>

          <div className="mt-auto pt-4">
            <div className="mb-4 flex items-center gap-3 px-2">
              <img 
                src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName}`} 
                alt="User" 
                className="h-10 w-10 rounded-full border border-line dark:border-gray-700"
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 truncate">
                <p className="text-sm font-bold text-content">{user?.displayName}</p>
                <p className="text-xs text-content-subtle truncate">{user?.email}</p>
              </div>
            </div>
            <button 
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
            >
              <LogOut className="h-5 w-5" />
              Sair do Sistema
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-canvas dark:bg-gray-950">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line dark:border-gray-800 bg-surface dark:bg-gray-900 px-4 lg:px-8">
          <button className="lg:hidden" onClick={() => setIsSidebarOpen(true)}>
            <Menu className="h-6 w-6 text-content-muted dark:text-gray-400" />
          </button>
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-content dark:text-gray-100 lg:text-xl">
              {currentPage === 'dashboard' ? 'Dashboard' : 
               currentPage === 'accounts' ? 'Contas Bancárias' : 
               currentPage === 'cards' ? 'Cartões de Crédito' :
               currentPage === 'transactions' ? 'Lançamentos' : 
               currentPage === 'reports' ? 'Relatórios' : 
               currentPage === 'budgets' ? 'Metas Financeiras' :
               currentPage === 'clients' ? 'Gestão de Clientes' :
               currentPage === 'services' ? 'Serviços e Planos' :
               currentPage === 'quotes' ? 'Orçamentos' :
               currentPage === 'suppliers' ? 'Fornecedores e Locais' :
               currentPage === 'health' ? 'Saúde Financeira' :
               currentPage === 'settings' ? 'Configurações' : 'Entidades'}
            </h1>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              filterType === 'ALL' ? "bg-orange-100 text-orange-700" :
              filterType === 'PF' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
            )}>
              {filterType === 'ALL' ? 'Consolidado' : filterType}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={toggleTheme}
              className="rounded-full p-2 text-content-subtle hover:bg-surface-muted dark:hover:bg-gray-800 hover:text-content-muted dark:hover:text-gray-300 transition-all"
              title={theme === 'light' ? 'Mudar para Modo Escuro' : 'Mudar para Modo Claro'}
            >
              {theme === 'light' ? <Sun className="h-5 w-5 text-amber-500" /> : <Moon className="h-5 w-5 text-blue-400" />}
            </button>
            <Notifications />
            <button 
              onClick={() => onNavigate('settings')}
              className="rounded-full p-2 text-content-subtle hover:bg-surface-muted dark:hover:bg-gray-800 hover:text-content-muted dark:hover:text-gray-300"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};
