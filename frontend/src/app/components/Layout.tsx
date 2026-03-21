import { Outlet } from 'react-router';
import { SidebarComponent } from './Sidebar';
import { SidebarProvider, SidebarTrigger } from './ui/sidebar';

export function Layout() {
  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full overflow-hidden">
        <SidebarComponent />
        <main className="flex-1 overflow-y-auto flex flex-col min-h-0 relative w-full">
          <div className="md:hidden absolute top-4 left-4 z-50">
            <SidebarTrigger />
          </div>
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  );
}
