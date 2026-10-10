import React from 'react';
import {useStaffSession} from './lib/useStaffSession';
export default function StaffSectionGate({section,children}){
 const {loading,signedIn}=useStaffSession(section);
 if(loading)return <p>Checking access…</p>;
 if(!signedIn)return <main role="alert"><h1>Access denied</h1><p>Sign in with an account authorized for this section.</p><a href="/">Staff sign in</a></main>;
 return children;
}
