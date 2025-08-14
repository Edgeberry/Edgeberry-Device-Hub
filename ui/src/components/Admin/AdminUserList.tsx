import { useEffect, useState } from "react";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import NotificationBox from "../Notification";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser } from "@fortawesome/free-solid-svg-icons";
import { api_admin_getUserList } from "../../api/admin";

const AdminUserList = (props:{selected?:string})=>{
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);
    const[ thingList, setThingList ] = useState<any[]>([]);

    useEffect(()=>{
        getThingsList();
    },[]);

    /* Get the list of things from the API */
    async function getThingsList(){
        const result = await api_admin_getUserList();
        if( result.message ){
            setIsError(true);
            setMessage(result.message);
            return;
        }
        console.log(result);
        setThingList(result);
    }

    return(
        <Container>
            <NotificationBox message={message} isError={isError}/>
            <Row className="asset-cartdeck" >
                {thingList.map((user:any)=>{return <AdminUserListItem user={user} key={user.uid.S} selected={props.selected===user.uid.S}/>})}
            </Row>
        </Container>
    );
}


export default AdminUserList;

const AdminUserListItem = (props:{user:any, selected:boolean})=>{

    return(
        <Container style={{padding:'1px'}}>
            <Card>
                <Row>
                    <Col xs='3' sm='2' md='1' style={{padding:'15px'}}>
                        <FontAwesomeIcon icon={faUser} style={{height:'100%', color:'gray'}} />
                    </Col>
                    <Col>
                        <div style={{height:'100%', padding:'5px'}}>
                            <div style={{fontWeight:'bold', fontSize:'1.2rem'}}>
                                {props.user?.profile?.M?.name?.S?props.user.profile.M.name.S:"Username"}
                            </div>
                            <div style={{color:'var(--edgeberry_dark_gray)'}}>
                                {props.user?.profile?.M?.email.S?props.user.profile.M.email.S:"E-mail"}<br/>
                                {props.user?.uid?.S?props.user?.uid.S:"User ID"}<br/>
                                {props.user?.account?.M?.status?.S?props.user.account.M.status.S:"Account Status"}<br/>
                                {props.user?.account?.M?.roles?.L?props.user.account.M.roles.L.map((role:any)=>{return role.S+' '}):"Roles"}
                            </div>
                        </div>
                    </Col>
                </Row>
            </Card>
        </Container>
    );
}
