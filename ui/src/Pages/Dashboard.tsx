import React from 'react';
import { Container } from 'react-bootstrap';
import { Outlet } from 'react-router-dom';
import NavigationBar from '../components/Navigationbar';

export default function Dashboard(props:{user:any}){
  return (
    <>
      <NavigationBar user={props.user} />
      <Container style={{ paddingTop: 16, textAlign: 'left' }}>
        <Outlet />
      </Container>
    </>
  );
}
