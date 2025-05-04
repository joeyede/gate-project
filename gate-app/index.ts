// Fix global Buffer polyfill before anything else
import { Buffer as BufferPolyfill } from 'buffer';

// Safely polyfill Buffer for all environments
if (typeof global !== 'undefined' && typeof global.Buffer === 'undefined') {
  // @ts-ignore
  global.Buffer = BufferPolyfill;
}

import { registerRootComponent } from 'expo';
import App from './App';

// Register the main component
registerRootComponent(App);
