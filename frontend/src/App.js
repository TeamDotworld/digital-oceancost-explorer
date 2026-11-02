import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Navigation from './components/Navigation';
import PrivateRoute from './components/PrivateRoute';
import LiveDropletDashboard from './components/LiveDropletDashboard';
import BandwidthDashboard from './components/BandwidthDashboard';
import DropletDetail from './components/DropletDetail';
import IpAddresses from './components/IpAddresses';
import Overview from './components/Overview';
import WasteFinder from './components/WasteFinder';
import Payments from './components/Payments';

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/dashboard" 
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <Dashboard />
              </>
            </PrivateRoute>
          } 
        />
        <Route 
          path="/droplets" 
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <LiveDropletDashboard />
              </>
            </PrivateRoute>
          } 
        />
        <Route
          path="/droplets/details"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <DropletDetail />
              </>
            </PrivateRoute>
          }
        />
        <Route
          path="/bandwidth"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <BandwidthDashboard />
              </>
            </PrivateRoute>
          } 
        />
        <Route
          path="/ip-addresses"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <IpAddresses />
              </>
            </PrivateRoute>
          }
        />
        <Route
          path="/overview"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <Overview />
              </>
            </PrivateRoute>
          }
        />
        <Route
          path="/waste"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <WasteFinder />
              </>
            </PrivateRoute>
          }
        />
        <Route
          path="/payments"
          element={
            <PrivateRoute>
              <>
                <Navigation />
                <Payments />
              </>
            </PrivateRoute>
          }
        />
        <Route path="/" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Router>
  );
};

export default App;