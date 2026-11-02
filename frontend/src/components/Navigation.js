import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../services/api';

// Summary first, then billing, then resources, then tools
const NAV_LINKS = [
  { to: '/overview', label: 'Overview' },
  { to: '/dashboard', label: 'Historical Costs' },
  { to: '/payments', label: 'Payments' },
  { to: '/droplets', label: 'Droplet Costs' },
  { to: '/ip-addresses', label: 'IP Addresses' },
  { to: '/waste', label: 'Waste Finder' },
  { to: '/bandwidth', label: 'Bandwidth Breakdown' }
];

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu after navigating
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await authService.logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Sub-pages such as /droplets/details keep their section highlighted
  const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  const linkClass = (path) => `rounded-md text-sm font-medium whitespace-nowrap ${
    isActive(path)
      ? 'bg-[#0069d9] text-white'
      : 'text-white hover:bg-[#0069d9]'
  }`;

  return (
    <nav className="bg-[#0080FF] text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center min-w-0">
            <Link to="/overview" className="flex-shrink-0 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="65.2 173.5 32 32" width="36" height="36" fill="#ffffff" className="mr-2"><path d="M81.202 205.5v-6.2c6.568 0 11.666-6.5 9.144-13.418a9.27 9.27 0 0 0-5.533-5.531c-6.912-2.502-13.425 2.575-13.425 9.14H65.2c0-10.463 10.124-18.622 21.1-15.195 4.8 1.505 8.618 5.313 10.105 10.1 3.43 10.99-4.717 21.107-15.203 21.107z"/><path d="M75.05 199.317v-6.165h6.168v6.165zm-4.753 4.75v-4.75h4.753v4.75h-4.753zm0-4.75h-3.973v-3.97h3.973v3.97z"/></svg>
              <span className="font-semibold text-lg sm:text-xl whitespace-nowrap">DO Cost Explorer</span>
            </Link>

            <div className="hidden xl:flex ml-6 space-x-1">
              {NAV_LINKS.map(link => (
                <Link key={link.to} to={link.to} className={`px-3 py-2 ${linkClass(link.to)}`}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center">
            <button
              onClick={handleLogout}
              className="hidden xl:block ml-4 px-3 py-2 rounded-md text-sm font-medium text-white bg-[#0069d9] hover:bg-[#005cbf]"
            >
              Logout
            </button>

            <button
              onClick={() => setMenuOpen(open => !open)}
              className="xl:hidden p-2 rounded-md hover:bg-[#0069d9] focus:outline-none focus:ring-2 focus:ring-white"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="xl:hidden border-t border-[#0069d9] px-4 py-3 space-y-1">
          {NAV_LINKS.map(link => (
            <Link key={link.to} to={link.to} className={`block px-3 py-2 ${linkClass(link.to)}`}>
              {link.label}
            </Link>
          ))}
          <button
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-white hover:bg-[#0069d9]"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navigation;
