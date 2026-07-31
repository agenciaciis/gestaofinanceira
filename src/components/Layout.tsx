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
  FileText,
  PiggyBank,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Notifications } from './Notifications';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  /** Recolhido: só o ícone, centralizado, com o nome no tooltip do sistema. */
  collapsed?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick, collapsed }) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    aria-label={label}
    className={cn(
      "flex w-full items-center rounded-lg text-sm font-medium transition-all",
      collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3",
      active
        ? "bg-primary text-white shadow-md"
        : "text-content-muted dark:text-gray-400 hover:bg-surface-muted dark:hover:bg-gray-800 hover:text-content dark:hover:text-gray-100"
    )}
  >
    <Icon className="h-5 w-5 shrink-0" />
    {!collapsed && label}
  </button>
);

/** Rótulo do grupo. Recolhido, vira apenas um traço separador. */
const NavGroup: React.FC<{ label: string; collapsed?: boolean }> = ({ label, collapsed }) =>
  collapsed ? (
    <div className="my-2 mx-3 border-t border-line dark:border-gray-800" />
  ) : (
    <p className="mt-5 mb-1 px-4 text-[10px] font-black uppercase tracking-widest text-content-subtle">
      {label}
    </p>
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
  /** Menu recolhido (só ícones). Preferência guardada neste dispositivo. */
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('finanflow:menu-recolhido') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('finanflow:menu-recolhido', next ? '1' : '0'); } catch { /* aba privada */ }
      return next;
    });
  };
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
        "fixed inset-y-0 left-0 z-50 transform bg-surface dark:bg-gray-900 border-r border-line dark:border-gray-800 shadow-xl transition-all duration-300 ease-in-out lg:static lg:translate-x-0",
        isCollapsed ? "w-20" : "w-64",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col p-4">
          <div className={cn("mb-6 flex items-center px-2", isCollapsed ? "justify-center" : "justify-between")}>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
                <Briefcase className="h-6 w-6" />
              </div>
              {!isCollapsed && (
                <div className="flex flex-col">
                  <span className="text-xl font-black text-content dark:text-gray-100 tracking-tighter">AGÊNCIA CIIS</span>
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">FinanFlow</span>
                </div>
              )}
            </div>
            <button
              onClick={toggleCollapsed}
              title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
              aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
              className={cn(
                "hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-content-subtle hover:bg-surface-muted hover:text-content transition-all",
                isCollapsed && "absolute left-1/2 -translate-x-1/2 top-[4.5rem]"
              )}
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
            <button className="lg:hidden text-content-subtle" onClick={() => setIsSidebarOpen(false)}>
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* View Filter Selector */}
          <div className="relative mb-8">
            <button 
              onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              title={isCollapsed ? `Visualização: ${getFilterLabel(filterType)}` : undefined}
              className={cn(
                "flex w-full items-center rounded-xl border border-line dark:border-gray-800 bg-canvas dark:bg-gray-800/50 p-3 text-left transition-all hover:bg-surface-muted dark:hover:bg-gray-800",
                isCollapsed ? "justify-center" : "justify-between"
              )}
            >
              <div className={cn("flex items-center", !isCollapsed && "gap-3")}>
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  filterType === 'PF' ? "bg-blue-100 text-blue-600" : 
                  filterType === 'PJ' ? "bg-purple-100 text-purple-600" : "bg-orange-100 text-orange-600"
                )}>
                  {getFilterIcon(filterType)}
                </div>
                {!isCollapsed && (
                  <div>
                    <p className="text-xs font-medium text-content-subtle">Visualização</p>
                    <p className="text-sm font-bold text-content truncate max-w-[120px]">{getFilterLabel(filterType)}</p>
                  </div>
                )}
              </div>
              {!isCollapsed && (
                <ChevronDown className={cn("h-4 w-4 text-content-subtle transition-transform", isFilterMenuOpen && "rotate-180")} />
              )}
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

          <nav className="flex-1 space-y-1 overflow-y-auto">
            <NavGroup label="Visão" collapsed={isCollapsed} />
            <NavItem icon={LayoutDashboard} label="Dashboard" collapsed={isCollapsed}
              active={currentPage === 'dashboard'} onClick={() => onNavigate('dashboard')} />
            <NavItem icon={PieChart} label="Relatórios" collapsed={isCollapsed}
              active={currentPage === 'reports'} onClick={() => onNavigate('reports')} />

            <NavGroup label="Dia a dia" collapsed={isCollapsed} />
            <NavItem icon={ArrowUpCircle} label="Lançamentos" collapsed={isCollapsed}
              active={currentPage === 'transactions'} onClick={() => onNavigate('transactions')} />
            <NavItem icon={Landmark} label="Contas" collapsed={isCollapsed}
              active={currentPage === 'accounts'} onClick={() => onNavigate('accounts')} />
            <NavItem icon={CreditCard} label="Cartões" collapsed={isCollapsed}
              active={currentPage === 'cards'} onClick={() => onNavigate('cards')} />

            <NavGroup label="Planejamento" collapsed={isCollapsed} />
            <NavItem icon={Target} label="Metas" collapsed={isCollapsed}
              active={currentPage === 'budgets'} onClick={() => onNavigate('budgets')} />
            <NavItem icon={PiggyBank} label="Caixinhas" collapsed={isCollapsed}
              active={currentPage === 'goals'} onClick={() => onNavigate('goals')} />
            <NavItem icon={Heart} label="Saúde Financeira" collapsed={isCollapsed}
              active={currentPage === 'health'} onClick={() => onNavigate('health')} />

            <NavGroup label="Comercial" collapsed={isCollapsed} />
            <NavItem icon={Users} label="Clientes" collapsed={isCollapsed}
              active={currentPage === 'clients'} onClick={() => onNavigate('clients')} />
            <NavItem icon={Package} label="Serviços" collapsed={isCollapsed}
              active={currentPage === 'services'} onClick={() => onNavigate('services')} />
            <NavItem icon={FileText} label="Orçamentos" collapsed={isCollapsed}
              active={currentPage === 'quotes'} onClick={() => onNavigate('quotes')} />
            <NavItem icon={Truck} label="Fornecedores" collapsed={isCollapsed}
              active={currentPage === 'suppliers'} onClick={() => onNavigate('suppliers')} />

            <NavGroup label="Sistema" collapsed={isCollapsed} />
            <NavItem icon={Users} label="Equipe" collapsed={isCollapsed}
              active={currentPage === 'team'} onClick={() => onNavigate('team')} />
            <NavItem icon={Settings} label="Ajustes" collapsed={isCollapsed}
              active={currentPage === 'settings'} onClick={() => onNavigate('settings')} />
          </nav>

          <div className="mt-auto pt-4">
            <div className={cn("mb-4 flex items-center px-2", isCollapsed ? "justify-center" : "gap-3")}>
              <img
                src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName}`}
                alt="User"
                title={isCollapsed ? (user?.email || '') : undefined}
                className="h-10 w-10 shrink-0 rounded-full border border-line dark:border-gray-700"
                referrerPolicy="no-referrer"
              />
              {!isCollapsed && (
                <div className="flex-1 truncate">
                  <p className="text-sm font-bold text-content">{user?.displayName}</p>
                  <p className="text-xs text-content-subtle truncate">{user?.email}</p>
                </div>
              )}
            </div>
            <button
              onClick={logout}
              title={isCollapsed ? 'Sair do Sistema' : undefined}
              aria-label="Sair do Sistema"
              className={cn(
                "flex w-full items-center rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all",
                isCollapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3"
              )}
            >
              <LogOut className="h-5 w-5 shrink-0" />
              {!isCollapsed && 'Sair do Sistema'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content — min-w-0 deixa o conteúdo encolher no mobile (senão uma
          tabela larga estoura a página inteira, causando scroll horizontal). */}
      <main className="flex-1 min-w-0 bg-canvas dark:bg-gray-950">
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
               currentPage === 'goals' ? 'Caixinhas & Objetivos' :
               currentPage === 'clients' ? 'Gestão de Clientes' :
               currentPage === 'services' ? 'Serviços e Planos' :
               currentPage === 'quotes' ? 'Orçamentos' :
               currentPage === 'suppliers' ? 'Fornecedores e Locais' :
               currentPage === 'health' ? 'Saúde Financeira' :
               currentPage === 'settings' ? 'Configurações' :
               currentPage === 'team' ? 'Equipe' : 'Entidades'}
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

        <div className="p-4 lg:p-8 min-w-0">
          {children}
        </div>
      </main>
    </div>
  );
};
