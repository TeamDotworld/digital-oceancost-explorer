import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../services/api';
import Footer from './Footer';

const Login = () => {
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  
  useEffect(() => {
    // Check if there's an error in URL params
    const queryParams = new URLSearchParams(location.search);
    const errorMsg = queryParams.get('error');
    if (errorMsg) {
      setError(errorMsg);
    }
    
    // Check if already authenticated
    const checkAuth = async () => {
      try {
        const { isAuthenticated } = await authService.checkAuthStatus();
        if (isAuthenticated) {
          navigate('/overview');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };
    
    checkAuth();
  }, [location, navigate]);
  
  const handleLogin = () => {
    authService.login();
  };
  
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4 py-8">
      <div className="w-full bg-white rounded-lg shadow-lg p-5 sm:p-8" style={{ maxWidth: '42rem' }}>
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">DigitalOcean Cost Explorer</h1>
          <p className="mt-2 text-gray-600">Comprehensive cost analysis for your DigitalOcean resources</p>
        </div>
        
        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}

        <div className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <h3 className="font-semibold text-blue-800 mb-2 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Historical Costs Dashboard
              </h3>
              <p className="text-sm text-gray-600">
                Analyze billing periods with detailed breakdowns by service type, visualize spending patterns, and identify cost trends.
              </p>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <h3 className="font-semibold text-blue-800 mb-2 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                Live Droplet Dashboard
              </h3>
              <p className="text-sm text-gray-600">
                Monitor current Droplet costs in real-time, categorized by region and tags to optimize your infrastructure spending.
              </p>
            </div>
          </div>
        </div>
        
        <button
          onClick={handleLogin}
          className="w-full bg-[#0080FF] hover:bg-[#0069d9] text-white font-medium py-3 px-4 rounded-md flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="65.2 173.5 32 32" width="36" height="36" fill="#ffffff" className="mr-2"><path d="M81.202 205.5v-6.2c6.568 0 11.666-6.5 9.144-13.418a9.27 9.27 0 0 0-5.533-5.531c-6.912-2.502-13.425 2.575-13.425 9.14H65.2c0-10.463 10.124-18.622 21.1-15.195 4.8 1.505 8.618 5.313 10.105 10.1 3.43 10.99-4.717 21.107-15.203 21.107z"/><path d="M75.05 199.317v-6.165h6.168v6.165zm-4.753 4.75v-4.75h4.753v4.75h-4.753zm0-4.75h-3.973v-3.97h3.973v3.97z"/></svg>
          Login with DigitalOcean
        </button>
        
        <div className="mt-6 p-4 text-sm bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-blue-800">
            Connect your DigitalOcean account to view cost data using <a href="https://docs.digitalocean.com/reference/api/oauth/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OAuth authentication</a>. This secure protocol enables access to your account information without requiring your password.
          </p>
          
          <button 
            onClick={() => setShowDetails(!showDetails)} 
            className="flex items-center text-blue-700 font-medium hover:text-blue-900 w-full justify-between mt-3"
          >
            <span>How does this tool work?</span>
            <svg 
              className={`w-5 h-5 transition-transform ${showDetails ? 'transform rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>
          
          {showDetails && (
            <div className="mt-3 p-3 bg-white rounded-md text-sm text-gray-700 border border-blue-100">
              <h3 className="font-medium mb-2">Technical details:</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <span className="font-medium">OAuth Authentication:</span> When you click "Login with DigitalOcean", you're redirected to DigitalOcean's authorization page. After approval, DigitalOcean sends an authorization code to our server.
                </li>
                <li>
                  <span className="font-medium">API Integration:</span> Our server exchanges this code for a Read-Only access token, which is used to securely request your account data from DigitalOcean's API.
                </li>
                <li>
                  <span className="font-medium">Session Management:</span> A secure HTTP-only cookie is created in your browser that contains a session ID (not your DigitalOcean credentials). This allows you to stay logged in.
                </li>
                <li>
                  <span className="font-medium">Data Privacy:</span> Your billing data is processed in your browser and is not stored on our servers. The session cookie is automatically expired after 1 day.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
      
      <Footer />
    </div>
  );
};

export default Login;
