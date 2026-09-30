import type {Metadata} from 'next';
import '../src/style.css';
export const metadata:Metadata={title:'Karibu · Financial workspace',description:'Attributed, balanced and traceable business operations.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
