import React from 'react';

const Footer = () => {
  return (
    <footer className="mt-8 mb-8 pb-6 text-center text-sm text-gray-500 px-4 mx-auto" style={{ maxWidth: '39rem' }}>
      <p>
        <a href="https://github.com/digitalocean-labs/cost-explorer" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Open source on GitHub</a><br />
        <br />
        This is <strong>not</strong> an official DigitalOcean app<br />
        Thoughtfully crafted by <a href="https://www.jackpearce.co.uk/" target="_blank" rel="noopener noreferrer"><strong>Jack Pearce</strong></a>, I hope you found it useful ❤️.
      </p>
    </footer>
  );
};

export default Footer;
